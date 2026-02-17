import { redirect } from 'next/navigation';

/**
 * Root page — redirects to the static landing page.
 * The actual landing page is served from public/landing/index.html
 * via the rewrite in next.config.mjs.
 */
export default function Home() {
    redirect('/landing/index.html');
}
