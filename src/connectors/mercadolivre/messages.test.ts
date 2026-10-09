import { describe, expect, it } from "vitest";

import { translateMlMessage } from "@/connectors/mercadolivre/messages";

describe("translateMlMessage", () => {
  it("translates known notices and keeps the original text", () => {
    expect(translateMlMessage("User has not mode me1")).toBe(
      "A conta não tem o Mercado Envios 1 (ME1) ativado. (User has not mode me1)",
    );
    expect(translateMlMessage("Free shipping costs exceeds sale")).toMatch(/frete grátis/);
  });

  it("shows unknown messages as they come", () => {
    expect(translateMlMessage("Something new")).toBe("Something new");
  });
});
