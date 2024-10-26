import prompty

def run():
    p = prompty.load("../../context.prompty")
    return p


async def run_async():
    p = await prompty.load_async("../../context.prompty")
    return p
