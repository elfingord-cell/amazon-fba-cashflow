/// <reference types="vite/client" />

import type * as React from "react";

declare global {
  namespace JSX {
    type Element = React.ReactElement;
  }
}
