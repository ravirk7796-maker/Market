# The Arshi Knot

A static storefront with Vercel Functions for the product API and Vercel Blob for persistent catalogue data and product photos.

## Deploy to Vercel

1. Push this repository to GitHub and import it from the Vercel dashboard.
2. In **Project Settings → Environment Variables**, set `ADMIN_PASSWORD` to a unique password with at least 16 characters. Do not commit it.
3. In the project **Storage** tab, create a **public Vercel Blob** store and connect it to the project for Production and Preview. Vercel supplies the Blob credentials to the Functions.
4. Redeploy after connecting storage and setting the password.

The shop URL is the Vercel project URL. The admin URL is the same URL with `/admin` appended. Product names and product photos are public; only admin product changes require the password.

The initial product list is seeded from `products.json`. The first admin change writes the persistent catalogue to Blob. The checked-in `uploads/` photo is used by the existing seed product that references it.

## Local preview

Run `server.ps1` from PowerShell to use the local file-backed development server at `http://127.0.0.1:8765/`. The local admin page is restricted to loopback; production uses the Vercel password login.
