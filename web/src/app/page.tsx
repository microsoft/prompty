import { VERSION } from "@/lib/version";

export default function Home() {
  return (
    <>
      <header>
        <h1 className="sitename">
          <a href="#">Prompty.ai</a>
        </h1>
        <aside className="share github">
          <img
            src="/assets/github_icon.svg"
            alt="GitHub logo icon of Octocat"
          />
          <a href="https://github.com/microsoft/prompty" target="_blank">
            GitHub
          </a>
          <img
            src="/assets/external_link.svg"
            alt="An external link icon of a box with an arrow out of the top right to show leaving the site or opening in a new tab."
          />
        </aside>
      </header>
      <main>
        <section className="hero">
          <h2 className="main-subheader">Agency with observability</h2>
          <p className="short-desc">
            Prompty is a new asset class and format for LLM prompts that aims to
            provide observability, understandability, and portability for
            developers.
          </p>
          <p className="learn-more-container">
            <a href="#whatIsPrompty" className="learn-more">
              Learn more
            </a>
          </p>
          <p className="logo-container">
            <img
              src="/assets/prompty_p.svg"
              alt="Prompty.ai logo of a capital 'P' with cartoon cute eyes and a thick border."
              className="large-logo"
            />
            <span className="logo-gradient"></span>
          </p>
        </section>

        <nav id="mainNav">
          <ul>
            <li className="mobile">
              <a href="#">Prompty.ai</a>
            </li>
            <li>
              <a href="#whatIsPrompty">What is Prompty?</a>
            </li>
            <li>
              <a href="#spec">Spec</a>
            </li>
            <li>
              <a href="#tooling">Tooling</a>
            </li>
            <li>
              <a href="#runtime">Runtime</a>
            </li>
            <li>
              <a href="#howToUseIt">How to use it</a>
            </li>
            <li>
              <a href="#benefits">Benefits</a>
            </li>
            <li className="mobile github">
              <img
                src="/assets/github_icon.svg"
                alt="GitHub logo icon of Octocat"
              />
              <a href="https://github.com/microsoft/prompty">GitHub</a>
              <img
                src="/assets/external_link.svg"
                alt="An external link icon of a box with an arrow out of the top right to show leaving the site or opening in a new tab."
              />
            </li>
          </ul>
        </nav>

        <section className="doc-item what-is" id="whatIsPrompty">
          <article>
            <h3>What is Prompty?</h3>
          </article>
          <div className="diagram">
            <div className="content">
              <p>
                Prompty is an asset class & format for LLM prompts that aims to
                provide observability, understandability, and portability for
                developers - the primary goal is to speed up the developer inner
                loop.
              </p>
              <p>
                Prompty is comprised of 3 things, the specification, its
                tooling, and runtime.
              </p>
            </div>

            <img
              src="/assets/images/prompty-venn.png"
              alt="Example of a Prompty file in VS Code using the Prompty extension."
            />
          </div>
        </section>

        <section className="doc-item" id="spec">
          <article>
            <h3>The specification</h3>
            <p>
              Prompty is intended to be a language agnostic asset class for
              creating and managing prompts.
            </p>
            <ul>
              <li>Uses common markdown format</li>
              <li>
                Modified front-matter to specify metadata, model settings,
                sample data (among other things)
              </li>
              <li>Content in a standard template format</li>
            </ul>
          </article>
          <div className="code-box">
            <img
              src="/assets/images/spec.png"
              alt="Example of a Prompty file in VS Code using the Prompty extension."
            />
          </div>
        </section>

        <section className="doc-item" id="tooling">
          <article>
            <h3>The tooling</h3>
            <p>
              Given the standard specification, there&apos;s a lot of nice
              things we can give developers in their environment.
            </p>

            <ul>
              <li>Front matter autocompletion</li>
              <li>Colorization / syntax highlighting</li>
              <li>Validation (with red squiggles for undefined variables)</li>
              <li>Quick run</li>
              <li>Code generation</li>
              <li>Evaluation generation</li>
            </ul>
          </article>
          <div className="code-box">
            <img
              src="/assets/images/tools.png"
              alt="Prompty tooling example of the Prompty extension in VS Code"
            />
          </div>
        </section>

        <section className="doc-item" id="runtime">
          <article>
            <h3>The runtime</h3>
            <p>
              Prompty runtime is the whatever engine that understands and can
              execute the format. As a standalone file, it can&apos;t really do
              anything without the help of the extension (when developing) or
              the runtime (when running).
            </p>
            <ul>
              <li>
                Targeting LangChain, Semantic Kernel, and Prompt Flow as
                supporting runtimes
              </li>
              <li>Works in Python (Prompt Flow and LangChain)</li>
              <li>Works in C# (Semantic Kernel)</li>
              <li>(Future Work) works in TypeScript/JavaScript</li>
              <li>Understood in Azure AI Studio</li>
            </ul>
          </article>
          <div className="code-box">
            <img
              src="/assets/images/runtime.png"
              alt="The Prompty runtime processing a .prompty file in VS Code using the Prompty extension."
            />
          </div>
        </section>

        <section className="doc-item how" id="howToUseIt">
          <h3>How do I use Prompty?</h3>
          <div className="card-container">
            <article className="cell">
              <i className="pill">Step 1</i>
              <h4>Feel confident while building</h4>
              <p>
                Any OpenAI key or Azure OpenAI key works. If you don&apos;t have
                either see below.
              </p>
            </article>
            <article className="cell">
              <i className="pill">Step 2</i>
              <h4>Flexible and simple</h4>
              <p>
                Get .prompty file syntax highlighting, tracing, and runtime
                support.
              </p>
              <p className="info-links">
                <a
                  href="https://marketplace.visualstudio.com/items?itemName=ms-toolsai.prompty"
                  target="_blank"
                >
                  Get the extension
                </a>
              </p>
            </article>
            <article className="cell">
              <i className="pill">Step 3</i>
              <h4>Language agnostic</h4>
              <p>
                See how easy it is to use prompty templates in this quick
                tutorial.
              </p>
            </article>
          </div>
        </section>

        <section className="benefits" id="benefits">
          <h3>What are the benefits of Prompty?</h3>
          <div className="grid-container">
            <div className="item0">
              <article className="cell item1">
                <i className="pill bullet-number">1</i>
                <h4>Feel confident while building</h4>
                <p>
                  Understand what&apos;s coming in and going out and how to manage it
                  effectively.
                </p>
              </article>
              <article className="cell item2">
                <i className="pill bullet-number">2</i>
                <h4>Language agnostic</h4>
                <p>Use with any language or framework you are familiar with.</p>
              </article>
              <article className="cell item3">
                <i className="pill bullet-number">3</i>
                <h4>Flexible and simple</h4>
                <p>
                  Integrate into whatever development environments or workflows
                  you have.
                </p>
              </article>
            </div>

            <article className="cell item4">
              <div>
                <h4>Standards open doors</h4>
                <p>
                  By working in a common format we open up opportunities for new
                  improvements.
                </p>

                <ul>
                  <li>
                    By default all prompty executions will produce tracing for
                    each prompty called
                  </li>
                  <li>
                    Developers can add additional tracing via simple SDK
                    functions
                  </li>
                  <li>
                    Tracing output uses OpenTelemetry so any/all existing
                    tooling around that standard can be used to visualize the
                    tracing output.
                  </li>
                </ul>
              </div>
              <img src="/assets/images/prompty-graph.png" alt="" />
            </article>
            <article className="cell item5">
              <div>
                <h4>Works for everyone</h4>
                <p>
                  Prompty is built on the premise that even with increasing
                  complexity in AI, a fundamental unit remains prompts. And
                  understanding this can lead to more innovative developments in
                  AI applications, for everyone. [focus on partners / how it
                  would work across stuff. more language support]
                </p>
              </div>
              <img src="/assets/images/prompty-ascii-art-globe.png" alt="" />
            </article>
          </div>
        </section>
      </main>
    </>
  );
}
