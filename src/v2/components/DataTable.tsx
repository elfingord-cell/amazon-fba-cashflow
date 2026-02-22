import type { TanStackGridProps } from "./TanStackGrid";
import { TanStackGrid } from "./TanStackGrid";

type DataTableProps<T extends object> = TanStackGridProps<T>;

export function DataTable<T extends object>({
  sorting = true,
  shellVariant = "single-frame",
  density = "compact",
  ...rest
}: DataTableProps<T>): JSX.Element {
  return (
    <TanStackGrid
      sorting={sorting}
      shellVariant={shellVariant}
      density={density}
      {...rest}
    />
  );
}
