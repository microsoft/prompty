namespace Prompty.Core {
  model Named<
    Item,
    StringValue extends valueof string = "Name of the item",
    Sample extends valueof unknown = #{ name: "Sample Name" }
  > {
    @doc(StringValue)
    @sample(Sample)
    name: string = "";

    ...Item;
  }

  alias SimpleTypes =
    | "string"
    | "integer"
    | "float"
    | "boolean"
    | "array"
    | "object"
    | string;
}
