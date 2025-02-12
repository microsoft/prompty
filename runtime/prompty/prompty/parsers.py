import base64
import re
from pathlib import Path

from .core import Prompty
from .invoker import Invoker


class PromptyChatParser(Invoker):
    """Prompty Chat Parser"""

    def __init__(self, prompty: Prompty) -> None:
        super().__init__(prompty)
        self.roles = ["assistant", "function", "system", "user", "tools"]
        if isinstance(self.prompty.file, str):
            self.prompty.file = Path(self.prompty.file).resolve().absolute()

        self.path = self.prompty.file.parent

    def inline_image(self, image_item: str) -> str:
        """Inline Image

        Parameters
        ----------
        image_item : str
            The image item to inline

        Returns
        -------
        str
            The inlined image
        """
        # pass through if it's a url or base64 encoded
        if image_item.startswith("http") or image_item.startswith("data"):
            return image_item
        # otherwise, it's a local file - need to base64 encode it
        else:
            image_path = Path(image_item)
            if not image_path.is_absolute():
                image_path = self.path / image_item

            with open(image_path, "rb") as f:
                base64_image = base64.b64encode(f.read()).decode("utf-8")

            if image_path.suffix == ".png":
                return f"data:image/png;base64,{base64_image}"
            elif image_path.suffix == ".jpg":
                return f"data:image/jpeg;base64,{base64_image}"
            elif image_path.suffix == ".jpeg":
                return f"data:image/jpeg;base64,{base64_image}"
            else:
                raise ValueError(
                    f"Invalid image format {image_path.suffix} - currently only .png and .jpg / .jpeg are supported."
                )
            
    def parse_args(self, args: str) -> dict[str, str]:
        """Parse args

        Parameters
        ----------
        args : str
            The args to parse

        Returns
        -------
        dict[str, str]
            The parsed args
        """
        # regular expression to parse key-value pairs
        string_matches = r"(\w+)\s*=\s*\"([^\"]*)\"\s*(,?)\s*"
        bool_matches = r"(\w+)\s*=\s*([Tt]rue|[Ff]alse)\s*(,?)\s*"
        float_matches = r"(\w+)\s*=\s*([0-9]+(\.[0-9]+))\s*(,?)\s*"
        int_matches = r"(\w+)\s*=\s*([0-9]+)\s*(,?)\s*"
        patterns = f"({string_matches}|{bool_matches}|{float_matches}|{int_matches})"

        matches = re.findall(patterns, args)
        full_args = {}
        for m in matches:
            if m[1] != "":
                full_args[m[1]] = m[2]
            elif m[4] != "":
                full_args[m[4]] = m[5].lower() == "true"
            elif m[7] != "":
                full_args[m[7]] = float(m[8])
            elif m[11] != "":
                full_args[m[11]] = int(m[12])

        return full_args

    def parse_content(self, content: str):
        """for parsing inline images

        Parameters
        ----------
        content : str
            The content to parse

        Returns
        -------
        any
            The parsed content
        """
        # regular expression to parse markdown images
        image = r"(?P<alt>!\[[^\]]*\])\((?P<filename>.*?)(?=\"|\))\)"
        matches = re.findall(image, content, flags=re.MULTILINE)
        if len(matches) > 0:
            content_items = []
            content_chunks = re.split(image, content, flags=re.MULTILINE)
            current_chunk = 0
            for i in range(len(content_chunks)):
                # image entry
                if (
                    current_chunk < len(matches)
                    and content_chunks[i] == matches[current_chunk][0]
                ):
                    content_items.append(
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": self.inline_image(
                                    matches[current_chunk][1].split(" ")[0].strip()
                                )
                            },
                        }
                    )
                # second part of image entry
                elif (
                    current_chunk < len(matches)
                    and content_chunks[i] == matches[current_chunk][1]
                ):
                    current_chunk += 1
                # text entry
                else:
                    if len(content_chunks[i].strip()) > 0:
                        content_items.append(
                            {"type": "text", "text": content_chunks[i].strip()}
                        )
            return content_items
        else:
            return content

    def invoke(self, data: str) -> list[dict[str, str]]:
        """Invoke the Prompty Chat Parser

        Parameters
        ----------
        data : str
            The data to parse

        Returns
        -------
        str
            The parsed data
        """
        messages = []
        # regular expression to capture boundary roles with optional key-value pairs
        boundary = r"(?i)^\s*#?\s*(" + "|".join(self.roles) + r")(\[((\w+)*\s*=\s*\"?([^\"]*)\"?\s*(,?)\s*)+\])?\s*:\s*"
        content_buffer = []

        # first role is system (if not specified)
        arg_buffer = {"role": "system"}

        for line in data.splitlines():
            # check if line is a boundary
            if re.match(boundary, line):
                # if content buffer is not empty, then add to messages
                if len(content_buffer) > 0:                        
                    messages.append(arg_buffer | { "content": self.parse_content("\n".join(content_buffer)) })
                    content_buffer = []

                # boundary check for args
                if "[" in line and "]" in line:
                    role, args = line[:-2].split("[", 2)
                    arg_buffer = self.parse_args(args) | {
                        "role": role.strip().lower(),
                    }
                # standard boundary
                else:
                    arg_buffer = {
                        "role": line.replace(":", "").strip().lower(),
                    }
            else:
                content_buffer.append(line)

        # add last message
        if len(content_buffer) > 0:                        
            messages.append(arg_buffer | { "content": self.parse_content("\n".join(content_buffer)) })
            content_buffer = []
            arg_buffer = {}

        return messages

    async def invoke_async(self, data: str) -> list[dict[str, str]]:
        """Invoke the Prompty Chat Parser (Async)

        Parameters
        ----------
        data : str
            The data to parse

        Returns
        -------
        str
            The parsed data
        """
        return self.invoke(data)
