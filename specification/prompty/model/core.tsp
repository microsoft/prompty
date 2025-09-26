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

  model Id<
    Item,
    StringValue extends valueof string = "The unique identifier of the item",
    Sample extends valueof unknown = #{ id: "unique-id" }
  > {
    @doc(StringValue)
    @sample(Sample)
    id: string = "";
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
