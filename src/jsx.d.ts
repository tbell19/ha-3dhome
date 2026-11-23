/* Home Assistant's elements as the Preact components (editor, scan view) use them. */
import "preact";

declare module "preact" {
  namespace JSX {
    interface IntrinsicElements {
      /** Home Assistant's icon element, for example <ha-icon icon="mdi:close" /> */
      "ha-icon": HTMLAttributes<HTMLElement> & { icon: string };
    }
  }
}
