# Roadmap

## Regla de la v1

Desde el 2026-10-29 la v1 (`Kuraos/Grimoire`, v0.10.0) **no recibe funciones nuevas**:
solo arreglos de bugs mientras siga en uso. Cualquier idea nueva se anota aquí, en
«Después del cambio».

## Fases

| Fase | Qué | Sale cuando |
|---|---|---|
| 0 | Prueba de arquitectura: dominio, Worker + D1, despliegue, APK mínima | `docs/tasks/fase-0.md` completo y CPU medido |
| 1 | Port del sistema visual y navegación adaptada | `docs/tasks/fase-1-port-ui.md` + navegación con capturas |
| 2 | **Mínimo para dejar la v1** (abajo), módulo por módulo | Cada módulo pasa sus tests de caracterización y tiene capturas |
| 3 | Respaldo y ensayo de restauración (ADR 0006) | Un dump restaurado y verificado |
| 4 | **Cambio**: migración de los datos reales y v1 a solo lectura | Conteos y totales verificados contra la v1 |
| 5+ | El resto de módulos, con la v2 ya en uso | — |

La fase 3 puede ir en paralelo con la 2, pero **la 4 no empieza sin la 3**.

## Mínimo para dejar la v1 (día 1)

Lo que tiene que funcionar en la v2, en el teléfono, la tablet y el PC, antes de migrar:

1. **Hábitos** — con rachas, cadencias, XP, niveles, vidas y penalización (ADR 0005).
2. **Tareas** — con proyectos.
3. **Pomodoro** — con la notificación de fin agendada en Android (ADR 0003).
4. **Diario**.
5. Lo transversal que esos cuatro necesitan: usuario (XP, nivel, título, vidas),
   Dashboard mínimo (lo de hoy), autenticación y modo sin conexión con cola de
   mutaciones.

Orden dentro de la fase 2: Hábitos → Tareas → Pomodoro → Diario. Cada uno de punta a
punta (dominio, API, UI adaptada) antes de abrir el siguiente.

## Después del cambio (fase 5+)

Sin orden decidido: check-ins, calendario, Erario, entrenamiento, estadísticas, logros,
misiones, revisión semanal, etiquetas, exportación a Obsidian, widgets en Kotlin.

Hasta que cada uno se porte, sus datos se migran igual (ADR 0006), aunque la v2 todavía
no tenga pantalla para ellos: se migra todo, se muestra lo que haya.
