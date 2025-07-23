namespace Prompty.Core {
  model Named<Item> {
    @doc("The name of the item")
    name: string = "";

    ...Item;
  }

  alias SimpleTypes = "string" | "number" | "array" | "object" | "boolean";
}
