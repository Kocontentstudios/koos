"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";

type ButtonControlProps = ButtonPrimitive.Props & { loading?: boolean };

/* The click guard lives behind "use client" so `Button` stays renderable from
   a Server Component: a handler created in button.tsx would be a function
   crossing the RSC boundary, which crashed /brand in round 3. */
function ButtonControl({ loading, onClick, ...props }: ButtonControlProps) {
  return (
    <ButtonPrimitive
      {...props}
      onClick={(event) => {
        /* Swallowing the click, rather than disabling, keeps the label on the
           fill its contrast is measured against. Enter in a form submits
           through a synthetic click on the submit button, so this blocks that
           too. */
        if (loading) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    />
  );
}

export { ButtonControl, type ButtonControlProps };
