import base64
import re
import typing
from collections.abc import Iterator
from pathlib import Path

import yaml

from .core import Prompty
from .invoker import Parser


class PromptyChatParser(Parser):
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
        string_match = r"\"([^\"]*)\""
        bool_match = r"([Tt]rue|[Ff]alse)"
        float_match = r"([0-9]+(\.[0-9]+))"
        int_match = r"([0-9]+)"

        s = f"({string_match}|{bool_match}|{float_match}|{int_match})"

        patterns = r"(\w+)\s*=\s*(" + s + r")\s*(,?)\s*"

        matches = re.findall(patterns, args)
        full_args = {}
        for m in matches:
            if m[3] != "":
                full_args[m[0]] = m[3]
            elif m[4] != "":
                full_args[m[0]] = m[4].lower() == "true"
            elif m[5] != "":
                full_args[m[0]] = float(m[5])
            elif m[7] != "":
                full_args[m[0]] = int(m[7])

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
                if current_chunk < len(matches) and content_chunks[i] == matches[current_chunk][0]:
                    content_items.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": self.inline_image(matches[current_chunk][1].split(" ")[0].strip())},
                        }
                    )
                # second part of image entry
                elif current_chunk < len(matches) and content_chunks[i] == matches[current_chunk][1]:
                    current_chunk += 1
                # text entry
                else:
                    if len(content_chunks[i].strip()) > 0:
                        content_items.append({"type": "text", "text": content_chunks[i].strip()})
            return content_items
        else:
            return content

    def parse(self, data: str) -> Iterator[dict[str, typing.Any]]:
        """Stream the data

        Parameters
        ----------
        data : str
            The data to stream

        Returns
        -------
        Iterator[str]
            The streamed data
        """
        # regular expression to capture boundary roles with optional key-value pairs
        boundary = (
            r"(?i)^\s*#?\s*(" + "|".join(self.roles) + r")(\[((\w+)*\s*=\s*\"?([^\"]*)\"?\s*(,?)\s*)+\])?\s*:\s*$"
        )
        content_buffer: list[str] = []
        # first role is system (if not specified)
        arg_buffer = {"role": "system"}

        for line in data.splitlines():
            # check of ![thread]
            if line.strip().startswith("![thread]"):
                # if content buffer is not empty, then add to messages
                if len(content_buffer) > 0:
                    yield arg_buffer | {"content": "\n".join(content_buffer)}
                    content_buffer = []

                arg_buffer = {
                    "role": "thread",
                }

            # check if line is a boundary
            elif re.match(boundary, line):
                # if content buffer is not empty, then add to messages
                if len(content_buffer) > 0:
                    yield arg_buffer | {"content": "\n".join(content_buffer)}
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
            yield arg_buffer | {"content": "\n".join(content_buffer)}

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
        for item in self.parse(data):
            if "content" in item:
                item["content"] = self.parse_content(item["content"])

            messages.append(item)

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

    def sanitize(self, data):
        # gets template before rendering
        # to clean up any sensitive data
        sanitized_prompt = []
        for item in self.parse(data):
            # add nonce to pre-rendered roles
            item["nonce"] = self.prompty.template.nonce
            role = item.pop("role")
            if "content" not in item:
                item["content"] = ""

            content = item.pop("content")

            # no need to sanitize threads
            if role == "thread":
                sanitized_prompt.append("![thread]")
                sanitized_prompt.append(content)
            else:

                def stringify(x):
                    return f'"{str(x)}"' if isinstance(x, str) else str(x)

                attr = [f"{k}={stringify(v)}" for k, v in item.items()]
                boundary = ",".join(attr)
                sanitized_prompt.append(f"{role}[{boundary}]:")
                sanitized_prompt.append(content)

        return "\n".join(sanitized_prompt)

    def process(self, data):
        # gets template after parse
        # to manage any parsed prompty
        # settings (in  this case, tools)
        if len(data) > 0 and data[0]["role"] == "tools":
            if self.prompty.template.strict and data[0]["nonce"] != self.prompty.template.nonce:
                raise ValueError("Nonce mismatch. Dynamic tools section not allowed in strict mode.")

            content = "tools:\n" + data[0]["content"]
            tools_dict = yaml.load(content, Loader=yaml.FullLoader)
            tools = Prompty.load_tools(tools_dict["tools"])
            self.prompty.merge_tools(tools)

            # remove first item from data
            data = data[1:]

        return data
