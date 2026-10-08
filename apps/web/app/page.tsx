import { redirect } from 'next/navigation';

// The workspace is the app; the root just routes into it.
export default function Home() {
  redirect('/workspace');
}
