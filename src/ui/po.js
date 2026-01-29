import { renderOrderModule } from "./orderEditorFactory.js";

const config = {
  slug: "po",
  entityKey: "pos",
  entityLabel: "PO",
  numberField: "poNo",
  listTitle: "Purchase Orders",
  formTitle: "PO bearbeiten/anlegen",
  numberLabel: "PO-Nummer",
  numberPlaceholder: "z. B. 25007",
  newButtonLabel: "Neue PO",
};

export function render(root) {
  return renderOrderModule(root, config);
}

export default { render };
