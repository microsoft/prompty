import Block from "@/components/block";
import Header from "@/components/nav/header";
import Main from "@/components/nav/main";
import { VERSION } from "@/lib/version";
import { GiH2O } from "react-icons/gi";

export default function Home() {
  return (
    <>
      <Header innerClassName="h-12 flex flex-row center items-center gap-3">
        <Main />
      </Header>
      <Block outerClassName="mt-2 md:mt-28" innerClassName="block">
        <section className="justify-center gap-5 md:gap-10 flex flex-col items-center">
          <h2 className="text-3xl sm:text-5xl font-normal max-w-[75%] text-center md:text-8xl bg-clip-text text-transparent bg-gradient-to-b dark:from-white dark:to-sky-400 from-70% from-black to-sky-400">
            Agency with observability
          </h2>
          <p className="md:max-w-[60%] text-sm md:text-xl text-center">
            Prompty is a new asset class and format for LLM prompts that aims to
            provide observability, understandability, and portability for
            developers.
          </p>
          <p className="relative overflow-visible h-auto w-[60%] md:w-[40%] mb-[-2rem] block">
            <img
              src="/assets/prompty_p.svg"
              alt="Prompty.ai logo of a capital 'P' with cartoon cute eyes and a thick border."
              className="relative overflow-visible text-center animate-[float_10s_ease-in-out_infinite]"
            />
            <span className="absolute block left-0 right-0 bottom-0 h-[25%] bg-gradient-to-b dark:from-transparent dark:to-zinc-800 to-40% from-transparent to-zinc-50"></span>
          </p>
        </section>
      </Block>
      <Block
        outerClassName="mt-8"
        innerClassName="flex flex-row justify-center"
      >
        <div className="text-xl md:text-3xl font-bold">What is Prompty?</div>
      </Block>
      <Block outerClassName="mt-8">
        <div className="bg-zinc-200 dark:bg-zinc-700 rounded-2xl flex flex-col md:flex-row justify-center gap-5 p-5">
          <div className="basis-1/2 lg:basis-1/3 text-xl">
            <p>
              Prompty is an asset class and format for LLM prompts that aims to
              provide observability, understandability, and portability for
              developers - the primary goal is to speed up the developer inner
              loop.
            </p>
            <p className="mt-2">Prompty is comprised of 3 things</p>
            <ul className="list-disc list-inside mt-3">
              <li>the specification,</li>
              <li>its tooling,</li>
              <li>and runtime.</li>
            </ul>
          </div>
          <div className="basis-1/2 lg:basis-1/3 flex justify-center bg-zinc-700 rounded-2xl">
            <img
              src="/assets/images/prompty-venn.png"
              alt="Example of a Prompty file in VS Code using the Prompty extension."
            />
          </div>
        </div>
      </Block>
      <Block outerClassName="mt-8 md:mt-16">
        <div className="flex flex-col md:flex-row justify-center gap-8 p-5 align-middle">
          <div className="basis-1/2 flex flex-col justify-center">
            <h2 className="text-xl md:text-3xl font-bold">The specification</h2>
            <p className="mt-3">
              Prompty is intended to be a language agnostic asset class for
              creating and managing prompts.
            </p>
            <ul className="list-disc mt-3 ms-8">
              <li>Uses common markdown format</li>
              <li>
                Modified front-matter to specify metadata, model settings,
                sample data (among other things)
              </li>
              <li>Content in a standard template format</li>
            </ul>
          </div>
          <div className="basis-1/2">
            <img
              src="/assets/images/spec.png"
              alt="Example of a Prompty file in VS Code using the Prompty extension."
              className="rounded-xl"
            />
          </div>
        </div>
      </Block>
      <Block outerClassName="mt-8 md:mt-16">
        <div className="flex flex-col justify-center gap-8 p-5 md:flex-row-reverse">
          <div className="basis-1/2 flex flex-col justify-center">
            <h2 className="text-xl md:text-3xl font-bold">The tooling</h2>
            <p className="mt-3">
              Given the standard specification, there's a lot of nice things we
              can give developers in their environment.
            </p>
            <ul className="list-disc mt-3 ms-8">
              <li>Front matter autocompletion</li>
              <li>Colorization / syntax highlighting</li>
              <li>Validation (with red squiggles for undefined variables)</li>
              <li>Quick run</li>
              <li>Code generation</li>
              <li>Evaluation generation</li>
            </ul>
          </div>
          <div className="basis-1/2">
            <img
              src="/assets/images/tools.png"
              alt="Prompty tooling example of the Prompty extension in VS Code"
              className="rounded-xl"
            />
          </div>
        </div>
      </Block>
      <Block outerClassName="mt-8 md:mt-16">
        <div className="flex flex-col md:flex-row justify-center gap-8 p-5">
          <div className="basis-1/2 flex flex-col justify-center">
            <h2 className="text-xl md:text-3xl font-bold">The runtime</h2>
            <p className="mt-3">
              Prompty runtime is the whatever engine that understands and can
              execute the format. As a standalone file, it can't really do
              anything without the help of the extension (when developing) or
              the runtime (when running).
            </p>
            <ul className="list-disc mt-3 ms-8">
              <li>
                Targeting LangChain, Semantic Kernel, and Prompt Flow as
                supporting runtimes
              </li>
              <li>Works in Python (Prompt Flow and LangChain)</li>
              <li>Works in C# (Semantic Kernel)</li>
              <li>(Future Work) works in TypeScript/JavaScript</li>
              <li>Understood in Azure AI Studio</li>
            </ul>
          </div>
          <div className="basis-1/2">
            <img
              src="/assets/images/runtime.png"
              alt="The Prompty runtime processing a .prompty file in VS Code using the Prompty extension."
              className="rounded-xl"
            />
          </div>
        </div>
      </Block>
      <Block
        outerClassName="mt-16"
        innerClassName="flex flex-row justify-center"
      >
        <div className="text-xl md:text-3xl font-bold">
          What are the benefits of Prompty?
        </div>
      </Block>
      <Block outerClassName="mt-8">
        <div className="bg-zinc-200 dark:bg-zinc-700 rounded-2xl flex flex-col md:flex-row gap-5 p-5">
          <div className="basis-1/3 text-xl flex flex-col items-start justify-start gap-3 p-3">
            <div className="text-sky-500 ring-1 rounded-full flex items-center justify-center h-8 w-8 p-3 text-xl">
              1
            </div>
            <h2 className="text-xl md:text-3xl font-bold">
              Feel confident while building
            </h2>
            <div>
              Understand what's coming in and going out and how to manage it
              effectively.
            </div>
          </div>
          <div className="basis-1/3 text-xl flex flex-col items-start justify-start gap-3 p-3">
            <div className="text-sky-500 ring-1 rounded-full flex items-center justify-center h-8 w-8 p-3 text-xl">
              2
            </div>
            <h2 className="text-xl md:text-3xl font-bold">Language agnostic</h2>
            <div>Use with any language or framework you are familiar with.</div>
          </div>
          <div className="basis-1/3 text-xl flex flex-col items-start justify-start gap-3 p-3">
            <div className="text-sky-500 ring-1 rounded-full flex items-center justify-center h-8 w-8 p-3 text-xl">
              3
            </div>
            <h2 className="text-xl md:text-3xl font-bold">
              Flexible and simple
            </h2>
            <div>
              Integrate into whatever development environments or workflows you
              have.
            </div>
          </div>
        </div>
      </Block>
      <Block outerClassName="mt-8 mb-8">&nbsp;</Block>
    </>
  );
}
