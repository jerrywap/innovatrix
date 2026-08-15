import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs tracking-[0.2em] text-neutral-400 uppercase">404</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          We couldn’t find that page.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-500">
          It may have moved, or the link may be out of date.
        </p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition hover:opacity-90 dark:bg-white dark:text-black"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
