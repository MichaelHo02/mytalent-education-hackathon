import Workspace from "./components/Workspace";
import HostBridge from "./components/HostBridge";

export const dynamic = "force-dynamic";

export default async function Home() {
  return <><HostBridge /><Workspace /></>;
}
