import { Prompty } from "../src/core";
import { InvokerFactory } from "../src/invokerFactory";
import * as fs from 'fs/promises';

describe("core load", () => {
  it.each`
    prompty
    ${"tests/prompts/basic.prompty"}
  `("should load $prompty", async ({prompty}) => {
    const p = await Prompty.load(prompty) 
    expect(p).toBeInstanceOf(Prompty);
  });
});


describe("prepare", () => {
  it.each([
    ["tests/prompts/basic.prompty"],
    ["tests/prompts/basic.mustache.prompty"],
  ])('Testing file: %s', async (prompty) => {
    //const factory = InvokerFactory.getInstance();
    const p = await Prompty.load(prompty)
    const prepared = await Prompty.prepare(p)
    console.log(JSON.stringify(prepared))
    // Path to the expected JSON file 
    const parsedJsonPath = `${prompty}.parsed.json`;

    // Read and parse the expected JSON content
    const expectedJsonContent = await fs.readFile(parsedJsonPath, 'utf8');
    const expectedJson = JSON.parse(expectedJsonContent.replaceAll('\r\n', '\n'));

    // Compare the prepared object with the expected JSON
    expect(prepared.length).toEqual(expectedJson.length);
    for (let i = 0; i < prepared.length; i++) {
      expect(prepared[i]["role"]).toEqual(expectedJson[i]["role"]);
      expect(prepared[i]["content"]).toEqual(expectedJson[i]["content"]);
    }
  })
});

 
// describe("execute", () => {
//   it.each`
//     prompty
//     ${"tests/prompty/basic.prompty"}
//   `("should execute $prompty", async ({prompty}) => {
//     const factory = InvokerFactory.getInstance();
//     const p = await Prompty.load(prompty)
//     const result = await Prompty.execute(p, {}, 
//       {
//         "connection": {
//           "azure_endpoint": process.env.AZURE_OPENAI_ENDPOINT,
//           "api_key": process.env.AZURE_OPENAI_KEY
//         },
//       }
//     )

//     console.log('====result', JSON.stringify(result))
//   }, 100000);
// });



// TODO: browser based test
// describe('Script Execution in Browser Context', () => {
//   it.each`
//     prompty
//     ${"tests/prompty/basic.prompty"}
//   `("should load $prompty", async ({filePath}) => {
//     const browser = await puppeteer.launch();
//     const page = await browser.newPage();

//     // Here you can inject and execute your script in the browser context
//     const result = await page.evaluate(async () => {
//       const factory = InvokerFactory.getInstance();
//       const p = await Prompty.load(filePath)
//       const prepared = Prompty.prepare(p)

//       // Path to the expected JSON file
//       const parsedJsonPath = `${filePath}.parsed.json`;

//       // Read and parse the expected JSON content
//       const expectedJsonContent = await fs.readFile(parsedJsonPath, 'utf8');
//       const expectedJson = JSON.parse(expectedJsonContent);

//       // Compare the prepared object with the expected JSON
//       expect(prepared).toEqual(expectedJson);
//     });
//     await browser.close();

//   });
// });