import { renderOrderModule } from "./orderEditorFactory.js";

const config = {
  slug: "fo",
  entityKey: "fos",
  entityLabel: "FO",
  numberField: "foNo",
  listTitle: "Forecast Orders",
  formTitle: "FO bearbeiten/anlegen",
  numberLabel: "FO-Nummer",
  numberPlaceholder: "z. B. FO2026-01",
  newButtonLabel: "Neue FO",
  convertTo: {
    entityKey: "pos",
    numberField: "poNo",
    targetLabel: "PO",
    buttonLabel: "In PO umwandeln",
  },
};

export default function render(root) {
  renderOrderModule(root, config);
}
