$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$catalogPath = Join-Path $root "products.json"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:8765/")

function Send-Response($context, [int]$status, [string]$contentType, [string]$body) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $context.Response.StatusCode = $status
  $context.Response.ContentType = $contentType
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.Headers["Cache-Control"] = "no-store"
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}

function Send-BinaryResponse($context, [int]$status, [string]$contentType, [byte[]]$bytes) {
  $context.Response.StatusCode = $status
  $context.Response.ContentType = $contentType
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.Headers["Cache-Control"] = "no-store"
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}

function Read-Catalog {
  $parsed = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($catalogPath, [System.Text.Encoding]::UTF8))
  foreach ($item in $parsed) {
    if ($item.PSObject.Properties["value"] -and $item.PSObject.Properties["Count"] -and $item.value -is [array]) {
      foreach ($product in $item.value) { $product }
    } else {
      $item
    }
  }
}

function Save-Catalog([object[]]$items) {
  $json = ConvertTo-Json -InputObject $items -Depth 8
  [System.IO.File]::WriteAllText($catalogPath, $json, [System.Text.UTF8Encoding]::new($false))
}

function Read-RequestBody($request) {
  $reader = [System.IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
  try {
    return ConvertFrom-Json -InputObject $reader.ReadToEnd() -ErrorAction Stop
  } finally {
    $reader.Dispose()
  }
}

function New-Product($body, [long]$id) {
  $price = 0.0
  $imageUri = $null
  $imageValue = [string]$body.image
  $allowedCategories = @("Knitwear", "Accessories", "Home", "Other")
  if ([string]::IsNullOrWhiteSpace([string]$body.name)) { throw "Enter a product name." }
  if (-not [double]::TryParse([string]$body.price, [Globalization.NumberStyles]::Number, [Globalization.CultureInfo]::InvariantCulture, [ref]$price) -or $price -le 0) { throw "Enter a valid price greater than zero." }
  if ($allowedCategories -notcontains [string]$body.category) { throw "Choose a valid category." }
  if ($imageValue -match '^data:image/(jpeg|png|webp|gif);base64,([A-Za-z0-9+/]+=*)$') {
    $imageType = $Matches[1]
    $encodedImage = $Matches[2]
    if ($imageValue.Length -gt 4200000) { throw "Product photos must be 3 MB or smaller." }
    try { $imageBytes = [Convert]::FromBase64String($encodedImage) } catch { throw "The uploaded photo is not a valid image." }
    if ($imageBytes.Length -gt 3MB) { throw "Product photos must be 3 MB or smaller." }
    $extension = if ($imageType -eq "jpeg") { "jpg" } else { $imageType }
    $uploadDirectory = Join-Path $root "uploads"
    [System.IO.Directory]::CreateDirectory($uploadDirectory) | Out-Null
    $imageFileName = "$id.$extension"
    [System.IO.File]::WriteAllBytes((Join-Path $uploadDirectory $imageFileName), $imageBytes)
    $imageValue = "/uploads/$imageFileName"
  } elseif ($imageValue -match '^/uploads/\d+\.(jpg|png|webp|gif)$') {
    if (-not (Test-Path (Join-Path $root $imageValue.TrimStart('/').Replace('/', '\')) -PathType Leaf)) { throw "The saved product photo could not be found." }
  } elseif (-not [Uri]::TryCreate($imageValue, [UriKind]::Absolute, [ref]$imageUri) -or $imageUri.Scheme -ne "https") {
    throw "Upload a product photo or use a secure https image URL."
  }
  if ([string]::IsNullOrWhiteSpace([string]$body.description)) { throw "Enter a product description." }
  return [pscustomobject][ordered]@{
    id = $id
    name = ([string]$body.name).Trim()
    category = [string]$body.category
    material = ([string]$body.material).Trim()
    color = ([string]$body.color).Trim()
    description = ([string]$body.description).Trim()
    price = $price
    tag = ([string]$body.tag).Trim()
    image = $imageValue
  }
}

$listener.Start()
Write-Host "Woolens shop: http://127.0.0.1:8765/"
Write-Host "Product admin: http://127.0.0.1:8765/admin"
Write-Host "Local-only server. Press Ctrl+C to stop."

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $path = $context.Request.Url.AbsolutePath
      $method = $context.Request.HttpMethod
      if ($path -eq "/api/products" -and $method -eq "GET") {
        $catalog = @(Read-Catalog)
        $json = ConvertTo-Json -InputObject ([object[]]$catalog) -Depth 8
        Send-Response $context 200 "application/json; charset=utf-8" $json
        continue
      }

      if ($path -match '^/uploads/(\d+\.(?:jpg|png|webp|gif))$' -and $method -eq "GET") {
        $imagePath = Join-Path (Join-Path $root "uploads") $Matches[1]
        if (Test-Path $imagePath -PathType Leaf) {
          $extension = [System.IO.Path]::GetExtension($imagePath).ToLowerInvariant()
          $contentType = switch ($extension) { ".jpg" { "image/jpeg" } ".png" { "image/png" } ".webp" { "image/webp" } ".gif" { "image/gif" } }
          Send-BinaryResponse $context 200 $contentType ([System.IO.File]::ReadAllBytes($imagePath))
        } else {
          Send-Response $context 404 "text/plain; charset=utf-8" "Image not found"
        }
        continue
      }

      if ($path -match "^/api/admin/products(?:/(\d+))?$" -and $method -in @("POST", "PUT", "DELETE")) {
        $catalog = @(Read-Catalog)
        if ($method -eq "POST" -and -not $Matches[1]) {
          $body = Read-RequestBody $context.Request
          $product = New-Product $body ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
          $catalog = @($catalog) + @($product)
          Save-Catalog -items $catalog
          Send-Response $context 201 "application/json; charset=utf-8" (ConvertTo-Json -InputObject $product -Depth 8 -Compress)
          continue
        }

        if (-not $Matches[1]) {
          Send-Response $context 400 "application/json; charset=utf-8" '{"error":"A product ID is required."}'
          continue
        }

        $productId = [long]$Matches[1]
        $found = $false
        if ($method -eq "PUT") {
          $body = Read-RequestBody $context.Request
          $replacement = New-Product $body $productId
          for ($index = 0; $index -lt $catalog.Count; $index++) {
            if ([long]$catalog[$index].id -eq $productId) {
              $catalog[$index] = $replacement
              $found = $true
              break
            }
          }
        } else {
          $remaining = @($catalog | Where-Object { [long]$_.id -ne $productId })
          $found = $remaining.Count -lt $catalog.Count
          $catalog = $remaining
        }

        if (-not $found) {
          Send-Response $context 404 "application/json; charset=utf-8" '{"error":"Product not found."}'
          continue
        }
        Save-Catalog -items $catalog
        $result = if ($method -eq "PUT") { ConvertTo-Json -InputObject $replacement -Depth 8 -Compress } else { '{"ok":true}' }
        Send-Response $context 200 "application/json; charset=utf-8" $result
        continue
      }

      if ($method -eq "GET" -and $path -in @("/", "/index.html", "/admin", "/admin/")) {
        $fileName = if ($path -like "/admin*") { "admin.html" } else { "index.html" }
        $filePath = Join-Path $root $fileName
        Send-Response $context 200 "text/html; charset=utf-8" ([System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8))
        continue
      }

      Send-Response $context 404 "text/plain; charset=utf-8" "Not found"
    } catch {
      $message = ConvertTo-Json -InputObject @{ error = $_.Exception.Message } -Compress
      try { Send-Response $context 400 "application/json; charset=utf-8" $message } catch { }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}