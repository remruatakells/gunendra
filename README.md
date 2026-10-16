# Gunendra Song Notebook

A private, single-owner song notebook built as one full-stack Next.js application.

## Stack

- Next.js 16 Route Handlers, React 19, Tailwind CSS 4 and Tiptap
- MySQL 8 with connection pooling and secure token authentication

## Run locally

MySQL 8 must be installed and running. The configured user needs permission to create the database on first run, or create `hla_bu` yourself and set `MYSQL_AUTO_CREATE_DATABASE=false`.

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

Then open `http://localhost:3000` and sign in with:

- Email: `owner@example.com`
- Password: `change-me`

Change this seeded password before deployment.

## Verification

```bash
cd web
npm run lint
npm run build
```

Configure the `MYSQL_*` values in `web/.env.local`. On first connection, the app creates the `hla_bu` database, tables and starter data automatically. Set `MYSQL_AUTO_CREATE_DATABASE=false` when using a managed provider that creates the database separately.
# gunendra
