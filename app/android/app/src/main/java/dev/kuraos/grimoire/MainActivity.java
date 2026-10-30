package dev.kuraos.grimoire;

import android.graphics.Color;
import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import androidx.activity.SystemBarStyle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Borde a borde también antes de Android 15: la web pinta las franjas de
        // sistema con --gr-chrome usando env(safe-area-inset-*). Sin esto, Android 13
        // dibuja sus barras en gris y el WebView queda entre ellas. dark = iconos claros.
        // Después de super.onCreate: antes, la ventana aún tiene el tema del splash y
        // queda una franja de 56 dp con su fondo encima del WebView.
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this, SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT));
    }
}
