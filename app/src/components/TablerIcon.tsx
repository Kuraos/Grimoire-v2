// Curated icon registry. Importing only the icons referenced by name (from the
// backend's achievement/quest data and the UI) lets the bundler tree-shake the
// rest of @tabler/icons-react — otherwise `import *` pulls in ~3.7 MB.
import {
  IconStar, IconTrophy, IconStars, IconDroplet, IconFlame, IconCalendarStats,
  IconSword, IconSwords, IconStairsUp, IconEye, IconCrown, IconSparkles, IconBook,
  IconBooks, IconCheckbox, IconShieldCheck, IconChecklist, IconMoodSmile,
  IconNotebook, IconAtom, IconTargetArrow, IconChecks, IconClockBolt, IconClockHour4,
  IconHeart, IconHeartBroken, IconAlertTriangle, IconArrowBackUp, IconLayoutDashboard, IconRepeat,
  IconListCheck, IconClock, IconCalendar, IconChartBar, IconPlayerPause, IconPlayerPlay,
  IconSettings, IconCopy, IconDownload, IconDatabase, IconBarbell, IconCoins, IconLink,
  type Icon,
} from "@tabler/icons-react";

const REGISTRY: Record<string, Icon> = {
  star: IconStar, trophy: IconTrophy, stars: IconStars, droplet: IconDroplet,
  flame: IconFlame, torch: IconFlame, "calendar-stats": IconCalendarStats,
  sword: IconSword, swords: IconSwords, "stairs-up": IconStairsUp, eye: IconEye,
  crown: IconCrown, sparkles: IconSparkles, book: IconBook, books: IconBooks,
  checkbox: IconCheckbox, "shield-check": IconShieldCheck, checklist: IconChecklist,
  heart: IconHeart,
  "mood-smile": IconMoodSmile, notebook: IconNotebook, atom: IconAtom,
  "target-arrow": IconTargetArrow, checks: IconChecks, "clock-bolt": IconClockBolt,
  "clock-hour-4": IconClockHour4, "heart-broken": IconHeartBroken,
  "alert-triangle": IconAlertTriangle, "arrow-back-up": IconArrowBackUp,
  "layout-dashboard": IconLayoutDashboard, repeat: IconRepeat, "list-check": IconListCheck,
  clock: IconClock, calendar: IconCalendar, "chart-bar": IconChartBar,
  "player-pause": IconPlayerPause, "player-play": IconPlayerPlay, settings: IconSettings,
  copy: IconCopy, download: IconDownload, database: IconDatabase,
  barbell: IconBarbell, coins: IconCoins, link: IconLink,
};

/** Render a Tabler icon by its DB-stored kebab-case name (e.g. "flame" → IconFlame). */
export function TablerIcon({ name, size = 18, className }: { name: string; size?: number; className?: string }) {
  const Comp = REGISTRY[name] ?? IconStar;
  return <Comp size={size} className={className} />;
}
