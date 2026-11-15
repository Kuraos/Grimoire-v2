import { SyncNotice } from "./components/layout/SyncNotice";
import { syncNotice, useLink } from "./api/home";
import { useQueue } from "./api/queryClient";

/** El aviso lee la cola aquí dentro: un cambio en la cola redibuja el aviso, no `App`. */
export function SyncNoticeHost() {
  const link = useLink();
  const text = syncNotice(link, useQueue());
  return <SyncNotice text={text} offline={!link.connected} />;
}
