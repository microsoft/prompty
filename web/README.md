# Prompty Website

The Prompty website is built with [Next.js](https://nextjs.org) and hosted on the GitHub Pages endpoint of this repository. You can view the production deployment at [https://prompty.ai](https://prompty.ai).


## Install Node.js and npm

You must have a local development environment with Node.js installed. You can use a pre-built environment in the cloud (with dev containers) or manually configure your local dev environment. _Pick one of these paths_.


1. (Option 1) **Launch in GitHub Codepsaces**. This will give you a development container in the cloud with one click.
    1. Click the button to launch the dev container.

        [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/microsoft/prompty)

    1. This will open a new browser tab with a Visual Studio Code Editor. Wait till loading completes and you see the terminal active in the editor.

1. (Option 2) **Install dependencies manually**. This lets you use your preferred local dev environment instead.
    1. Install [Node Version Manager (nvm)](https://github.com/nvm-sh/nvm?tab=readme-ov-file#installing-and-updating). We recommend using this approach for flexibility in managing different Node.js requirements across projects.
    1. Use nvm to install a Node.js version 18.0 or higher if required - for instance, you can install the latest stable version using :

        ```
        nvm install --lts
        ```
    1. You can now activate the required version of Node.js using nvm - for instance, activate LTS version as:

        ```
        nvm use --lts
        ```
    1. This should also make the `npm` tooling available.

Verify your development environment is ready:

```bash
# Check Node.js version
node --version

# Check npm version
npm --version
```


## Build & Preview Locally

We assume you have cloned the repo and completed the install step above, to get the development environment ready.

1. The Prompty website source is in the `web/` folder of the repo. Open your terminal to that folder

    ```bash
    cd web
    ```

1.  Install the package dependencies with this command. 

    ```bash
    npm install
    ```

1. Start a local dev server to preview the website. 

    ```bash
    npm run dev
    ```
1. This should open a local dev server on port 3000 with _hot-reload_ functionality. Any changes you now make to the documentation will be reflected in the preview.


## Build & Preview Production Version

Once you complete your changes, you may want to verify that the _production_ build reflects behaviors correctly.

1. Run the command below to get a production build

    ```bash
    npm run build
    ```

1. Preview this build in your browser with this command:

    ```bash
    npm run start
    ```


## Contributing To Documentation

Read the [Contributing](https://www.prompty.ai/docs/contributing) section of the documentation for details.
