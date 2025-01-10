import Block from "@/components/block";
import { Metadata } from "next";
import styles from "./page.module.scss";
import clsx from "clsx";

export const metadata: Metadata = {
  title: "prompty.ai",
  description:
    "Prompty is a new asset class and format for LLM prompts that aims to provide observability, understandability, and portability for developers.",
  icons: [
    "/assets/images/favicon-16x16.png",
    "/assets/images/favicon-32x32.png",
  ],
};

export default function Home() {
  return (
    <div className={styles.home}>
      <Block outerClassName={styles.heroContainer}>
        <section className={styles.heroSection}>
          <h2 className={styles.heroTitle}>Agency with observability</h2>
          <p className={styles.heroDescription}>
            Prompty is a new asset class and format for LLM prompts that aims to
            provide observability, understandability, and portability for
            developers.
          </p>
          <div className={styles.heroButtonSection}>
            <a
              href="https://marketplace.visualstudio.com/items?itemName=ms-toolsai.prompty"
              target="_blank"
              className={styles.heroLink}
            >
              Get the Extension
            </a>
          </div>
          <p className={styles.promptyContainer}>
            <img
              src="/assets/prompty_p.svg"
              alt="Prompty.ai logo of a capital P with cartoon cute eyes and a thick border."
              className={styles.promptyIcon}
            />
            <span className={styles.promptyGradient}></span>
          </p>
        </section>
      </Block>
      <Block
        outerClassName={styles.sectionGap}
        innerClassName={styles.centerContent}
      >
        <div className={styles.titleContent}>What is Prompty?</div>
      </Block>
      <Block outerClassName={styles.sectionGap}>
        <div className={styles.colorbox}>
          <div className={styles.whatis}>
            <p>
              Prompty is an asset class and format for LLM prompts that aims to
              provide observability, understandability, and portability for
              developers - the primary goal is to speed up the developer inner
              loop.
            </p>
            <p>Prompty is comprised of 3 things</p>
            <ul className={styles.itemList}>
              <li>the specification,</li>
              <li>its tooling,</li>
              <li>and runtime.</li>
            </ul>
          </div>
          <div className={styles.whatisvenn}>
            <img
              src="/assets/images/prompty-venn.png"
              alt="Example of a Prompty file in VS Code using the Prompty extension."
            />
          </div>
        </div>
      </Block>
      <Block outerClassName={styles.sectionGap}>
        <div className={styles.tileReverse}>
          <div className={styles.tileContainer}>
            <h2 className={styles.tileTitle}>The specification</h2>
            <p>
              Prompty is intended to be a language agnostic asset class for
              creating and managing prompts.
            </p>
            <ul className={styles.itemList}>
              <li>Uses common markdown format</li>
              <li>
                Modified front-matter to specify metadata, model settings,
                sample data (among other things)
              </li>
              <li>Content in a standard template format</li>
            </ul>
          </div>
          <div className={styles.tileImage}>
            <img
              src="/assets/images/spec.png"
              alt="Example of a Prompty file in VS Code using the Prompty extension."
            />
          </div>
        </div>
      </Block>
      <Block outerClassName={styles.sectionGap}>
        <div className={styles.tileSection}>
          <div className={styles.tileContainer}>
            <h2 className={styles.tileTitle}>The tooling</h2>
            <p>
              Given the standard specification, there&apos;s a lot of nice
              things we can give developers in their environment.
            </p>
            <ul className={styles.itemList}>
              <li>Front matter autocompletion</li>
              <li>Colorization / syntax highlighting</li>
              <li>Validation (with red squiggles for undefined variables)</li>
              <li>Quick run</li>
              <li>Code generation</li>
              <li>Evaluation generation</li>
            </ul>
          </div>
          <div className={styles.tileImage}>
            <img
              src="/assets/images/tools.png"
              alt="Prompty tooling example of the Prompty extension in VS Code"
            />
          </div>
        </div>
      </Block>
      <Block outerClassName={styles.sectionGap}>
        <div className={styles.tileReverse}>
          <div className={styles.tileContainer}>
            <h2 className={styles.tileTitle}>The runtime</h2>
            <p>
              Prompty runtime is the whatever engine that understands and can
              execute the format. As a standalone file, it can&apos;t really do
              anything without the help of the extension (when developing) or
              the runtime (when running).
            </p>
            <ul className={styles.itemList}>
              <li>Works in Python</li>
              <li>Works in C#</li>
              <li>(In progress) works in TypeScript/JavaScript</li>
            </ul>
          </div>
          <div className={styles.tileImage}>
            <img
              src="/assets/images/runtime.png"
              alt="The Prompty runtime processing a .prompty file in VS Code using the Prompty extension."
            />
          </div>
        </div>
      </Block>
      <Block
        outerClassName={styles.sectionGap}
        innerClassName={styles.centerContent}
      >
        <div className={styles.titleContent}>
          What are the benefits of Prompty?
        </div>
      </Block>
      <Block outerClassName={styles.sectionGap}>
        <div className={styles.numberSection}>
          <div className={styles.numberContainer}>
            <div className={styles.number}>1</div>
            <h2 className={styles.numberTitle}>
              Feel confident while building
            </h2>
            <div>
              Understand what&apos;s coming in and going out and how to manage
              it effectively.
            </div>
          </div>
          <div className={styles.numberContainer}>
            <div className={styles.number}>2</div>
            <h2 className={styles.numberTitle}>Language agnostic</h2>
            <div>Use with any language or framework you are familiar with.</div>
          </div>
          <div className={styles.numberContainer}>
            <div className={styles.number}>3</div>
            <h2 className={styles.numberTitle}>Flexible and simple</h2>
            <div>
              Integrate into whatever development environments or workflows you
              have.
            </div>
          </div>
        </div>
      </Block>
      <Block outerClassName={styles.sectionGap}>
        <div className={styles.halfSection}>
          <div className={clsx(styles.halfColorbox, styles.promptyGraph)}>
            <h2 className={styles.tileTitle}>Standards open doors</h2>
            <div>
              By working in a common format we open up opportunities for new
              improvements.
            </div>
            <ul className={styles.itemList}>
              <li>
                By default all prompty executions will produce tracing for each
                prompty called
              </li>
              <li>
                Developers can add additional tracing via simple SDK functions
              </li>
              <li>
                Tracing output uses OpenTelemetry so any/all existing tooling
                around that standard can be used to visualize the tracing
                output.
              </li>
            </ul>
            <div className={styles.spacer}>&nbsp;</div>
          </div>
          <div className={clsx(styles.halfColorbox, styles.promptyWorld)}>
            <h2 className={styles.tileTitle}>Works for everyone</h2>
            <div>
              Prompty is built on the premise that even with increasing
              complexity in AI, a fundamental unit remains prompts. And
              understanding this can lead to more innovative developments in AI
              applications, for everyone.
            </div>
            <div className={styles.spacer}>&nbsp;</div>
          </div>
        </div>
      </Block>
    </div>
  );
}
