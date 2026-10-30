import type { CapacitorConfig } from '@capacitor/cli'

// origen del WebView: https://localhost (androidScheme y hostname por defecto de Capacitor 8)
const config: CapacitorConfig = {
  appId: 'dev.kuraos.grimoire',
  appName: 'Grimoire',
  webDir: 'dist',
}

export default config
