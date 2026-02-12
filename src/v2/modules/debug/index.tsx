import { LegacyModulePage } from "../legacy/LegacyModulePage";

export default function ModulePage(): JSX.Element {
  return (
    <LegacyModulePage
      title="Debug"
      description="Legacy-Modul laeuft innerhalb der V2-Shell fuer schrittweise Migration mit voller Fachlogik."
      loader={() => import("../../../ui/debug.js")}
    />
  );
}
