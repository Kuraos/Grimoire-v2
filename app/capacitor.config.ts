import type { CapacitorConfig } from '@capacitor/cli'

// origen del WebView: https://localhost (androidScheme y hostname por defecto de Capacitor 8)
const config: CapacitorConfig = {
  // por defecto, en debug registra en logcat lo que devuelven los plugins: también el token
  loggingBehavior: 'none',
  appId: 'dev.kuraos.grimoire',
  appName: 'Grimoire',
  webDir: 'dist',
  plugins: {
    // borde a borde: la web pinta las franjas de sistema (env(safe-area-inset-*)).
    // DARK = iconos claros, sobre el cromo oscuro.
    SystemBars: { insetsHandling: 'css', initialViewportFitValueHint: 'cover', style: 'DARK' },
  },
}

export default config
