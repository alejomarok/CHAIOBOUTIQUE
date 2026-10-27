import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { Form } from "@/components/ui/form";

function Example() {
  const form = useForm({ defaultValues: { name: "" } });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => {})}>
        <input aria-label="Nombre" {...form.register("name")} />
        <button type="submit">Guardar</button>
      </form>
    </Form>
  );
}

describe("form hydration", () => {
  it("disables controls in server HTML before submit handlers attach", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Example />);
    expect(container.querySelector("fieldset")).toHaveAttribute("disabled");
  });

  it("enables controls when the client can handle interaction", () => {
    render(<Example />);
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(screen.getByLabelText("Nombre")).toBeEnabled();
  });
});
