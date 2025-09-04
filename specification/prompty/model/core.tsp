namespace Prompty.Core {
  model Named<Item, StringValue extends valueof string = "Name of the item"> {
    @doc(StringValue)
    name: string = "";

    ...Item;
  }

  alias SimpleTypes = "string" | "number" | "array" | "object" | "boolean" | string;
}
