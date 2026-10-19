import './style.css';
import { App } from './app';

function supportsWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

if (!supportsWebGL()) {
  document.body.innerHTML =
    '<div style="font-family:system-ui;padding:32px;text-align:center"><h2>WebGL tidak tersedia</h2><p>Loop Builders membutuhkan browser dengan WebGL aktif.</p></div>';
} else {
  // Opsi uji: ?frame=390x844 memaksa ukuran kontainer (simulasi ponsel di desktop).
  const frame = new URLSearchParams(location.search).get('frame')?.match(/^(\d+)x(\d+)$/);
  if (frame) {
    const el = document.getElementById('app')!;
    el.style.width = `${frame[1]}px`;
    el.style.minWidth = '0';
    el.style.height = `${frame[2]}px`;
    el.style.alignSelf = 'center';
  }
  const app = new App();
  // Akses debug di konsol (tidak dipakai gameplay).
  (window as unknown as { loopBuilders: App }).loopBuilders = app;
}
