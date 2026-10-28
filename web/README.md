This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Firebase Google Login (Brain2)

1. Copy `.env.local.example` to `.env.local`.
2. Fill these values from Firebase Console > Project settings > Your apps (Web app):
	- `NEXT_PUBLIC_FIREBASE_API_KEY`
	- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
	- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
	- `NEXT_PUBLIC_FIREBASE_APP_ID`
3. In Firebase Console > Authentication > Sign-in method, enable `Google` provider.
4. In Firebase Console > Authentication > Settings > Authorized domains, add your local/host domain if needed (e.g. `brain2-corevo2.vercel.app` and any custom domain).

After that, start the app and use `Entrar com Google` on the login screen.

### Vercel (Production)

In the Vercel project **Settings → Environment Variables**, set the same keys as in `.env.local` for **Production**, **Preview**, and **Development**:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` (optional)
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` (optional)
- `NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID` (optional, for Drive in settings)

Or from `web/`, after `npx vercel login`:

```bash
VERCEL_PROJECT=your-project-name ./scripts/sync-firebase-env-vercel.sh
npx vercel --prod
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

A app Next.js vive em `web/`. O repositório inclui **`package.json` na raiz** (só para a Vercel detetar `next`) e **`vercel-build`** que corre `next build` dentro de `web/`.

Se o log mostrar `npm install --prefix web`, o **Root Directory no dashboard não está em `web`** — limpa overrides antigos:

1. **Settings → Build and Deployment → Root Directory:** deixa **vazio** (repo root) *ou* define **`web`** (não uses os dois ao mesmo tempo com install `--prefix web`).
2. **Install / Build Command:** vazio (default) *ou* deixa o `vercel.json` da raiz do repo.
3. Redeploy.

Guia: [Next.js deployment](https://nextjs.org/docs/app/building-your-application/deploying).
