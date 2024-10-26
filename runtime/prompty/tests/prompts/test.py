import prompty

def run():
    p = prompty.load("basic.prompty")
    return p

async def run_async():
    p = await prompty.load_async("basic.prompty")
    return p