import * as React from "react";

import { cn } from "@/lib/utils";

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  ),
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const DEFAULT_VISIBLE_ROWS = 50;

function flattenTableChildren(children: React.ReactNode): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.type === React.Fragment) {
      rows.push(...flattenTableChildren(child.props.children));
    } else if (child !== null && child !== undefined && typeof child !== "boolean") {
      rows.push(child);
    }
  });
  return rows;
}

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement> & { showAllRows?: boolean }
>(({ className, children, showAllRows = false, ...props }, ref) => {
  const [visibleRows, setVisibleRows] = React.useState(DEFAULT_VISIBLE_ROWS);
  const rows = flattenTableChildren(children);
  const rowSignature = rows.map((row) => React.isValidElement(row) ? String(row.key) : String(row)).join("|");
  React.useEffect(() => setVisibleRows(DEFAULT_VISIBLE_ROWS), [rowSignature]);

  const rowLimit = showAllRows ? rows.length : visibleRows;
  const shownRows = rows.slice(0, rowLimit);
  const firstRow = rows[0];
  const columnCount = React.isValidElement<{ children?: React.ReactNode }>(firstRow)
    ? Math.max(1, React.Children.count(firstRow.props.children))
    : 1;

  return (
    <>
      <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props}>
        {shownRows}
      </tbody>
      {!showAllRows && rows.length > visibleRows && (
        <tfoot>
          <tr className="border-t">
            <td colSpan={columnCount} className="px-3 py-3 text-center text-sm text-muted-foreground">
              <span>يُعرض {visibleRows.toLocaleString("ar-IQ")} من {rows.length.toLocaleString("ar-IQ")} صفاً</span>
              <button
                type="button"
                className="ms-3 font-semibold text-primary underline-offset-4 hover:underline"
                onClick={() => setVisibleRows((count) => Math.min(count + DEFAULT_VISIBLE_ROWS, rows.length))}
              >
                عرض 50 صفاً إضافياً
              </button>
            </td>
          </tr>
        </tfoot>
      )}
    </>
  );
});
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-11 px-3 text-start align-middle text-xs font-bold text-muted-foreground [&:has([role=checkbox])]:ps-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3 py-3 text-start align-middle [&:has([role=checkbox])]:ps-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
