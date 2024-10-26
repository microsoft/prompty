import os
import pytest
import prompty
from prompty.invoker import InvokerFactory

from tests.fake_azure_executor import FakeAzureExecutor
from tests.fake_serverless_executor import FakeServerlessExecutor
from prompty.azure import AzureOpenAIProcessor
from prompty.serverless import ServerlessProcessor

from dotenv import load_dotenv

load_dotenv()


@pytest.fixture(scope="module", autouse=True)
def fake_azure_executor():
    InvokerFactory.add_executor("azure", FakeAzureExecutor)
    InvokerFactory.add_executor("azure_openai", FakeAzureExecutor)
    InvokerFactory.add_processor("azure", AzureOpenAIProcessor)
    InvokerFactory.add_processor("azure_openai", AzureOpenAIProcessor)
    InvokerFactory.add_executor("serverless", FakeServerlessExecutor)
    InvokerFactory.add_processor("serverless", ServerlessProcessor)


@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
        "prompts/faithfulness.prompty",
        "prompts/embedding.prompty",
    ],
)
def test_basic_execution(prompt: str):
    result = prompty.execute(prompt)
    print(result)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "prompt",
    [
        "prompts/basic.prompty",
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
        "prompts/faithfulness.prompty",
        "prompts/embedding.prompty",
    ],
)
async def test_basic_execution_async(prompt: str):
    result = await prompty.execute_async(prompt)
    print(result)


def get_customer(customerId):
    return {"id": customerId, "firstName": "Sally", "lastName": "Davis"}


def get_context(search):
    return [
        {
            "id": "17",
            "name": "RainGuard Hiking Jacket",
            "price": 110,
            "category": "Hiking Clothing",
            "brand": "MountainStyle",
            "description": "Introducing the MountainStyle RainGuard Hiking Jacket - the ultimate solution for weatherproof comfort during your outdoor undertakings! Designed with waterproof, breathable fabric, this jacket promises an outdoor experience that's as dry as it is comfortable. The rugged construction assures durability, while the adjustable hood provides a customizable fit against wind and rain. Featuring multiple pockets for safe, convenient storage and adjustable cuffs and hem, you can tailor the jacket to suit your needs on-the-go. And, don't worry about overheating during intense activities - it's equipped with ventilation zippers for increased airflow. Reflective details ensure visibility even during low-light conditions, making it perfect for evening treks. With its lightweight, packable design, carrying it inside your backpack requires minimal effort. With options for men and women, the RainGuard Hiking Jacket is perfect for hiking, camping, trekking and countless other outdoor adventures. Don't let the weather stand in your way - embrace the outdoors with MountainStyle RainGuard Hiking Jacket!",
        },
        {
            "id": "3",
            "name": "Summit Breeze Jacket",
            "price": 120,
            "category": "Hiking Clothing",
            "brand": "MountainStyle",
            "description": "Discover the joy of hiking with MountainStyle's Summit Breeze Jacket. This lightweight jacket is your perfect companion for outdoor adventures. Sporting a trail-ready, windproof design and a water-resistant fabric, it's ready to withstand any weather. The breathable polyester material and adjustable cuffs keep you comfortable, whether you're ascending a mountain or strolling through a park. And its sleek black color adds style to function. The jacket features a full-zip front closure, adjustable hood, and secure zippered pockets. Experience the comfort of its inner lining and the convenience of its packable design. Crafted for night trekkers too, the jacket has reflective accents for enhanced visibility. Rugged yet chic, the Summit Breeze Jacket is more than a hiking essential, it's the gear that inspires you to reach new heights. Choose adventure, choose the Summit Breeze Jacket.",
        },
        {
            "id": "10",
            "name": "TrailBlaze Hiking Pants",
            "price": 75,
            "category": "Hiking Clothing",
            "brand": "MountainStyle",
            "description": "Meet the TrailBlaze Hiking Pants from MountainStyle, the stylish khaki champions of the trails. These are not just pants; they're your passport to outdoor adventure. Crafted from high-quality nylon fabric, these dapper troopers are lightweight and fast-drying, with a water-resistant armor that laughs off light rain. Their breathable design whisks away sweat while their articulated knees grant you the flexibility of a mountain goat. Zippered pockets guard your essentials, making them a hiker's best ally. Designed with durability for all your trekking trials, these pants come with a comfortable, ergonomic fit that will make you forget you're wearing them. Sneak a peek, and you are sure to be tempted by the sleek allure that is the TrailBlaze Hiking Pants. Your outdoors wardrobe wouldn't be quite complete without them.",
        },
    ]


def get_response(customerId, question, prompt):
    customer = get_customer(customerId)
    context = get_context(question)

    result = prompty.execute(
        prompt,
        inputs={"question": question, "customer": customer, "documentation": context},
    )
    return {"question": question, "answer": result, "context": context}


async def get_response_async(customerId, question, prompt):
    customer = get_customer(customerId)
    context = get_context(question)

    result = await prompty.execute_async(
        prompt,
        inputs={"question": question, "customer": customer, "documentation": context},
    )
    return {"question": question, "answer": result, "context": context}


def test_context_flow():
    customerId = 1
    question = "tell me about your jackets"
    prompt = "context.prompty"

    response = get_response(customerId, question, f"prompts/{prompt}")
    print(response)


@pytest.mark.asyncio
async def test_context_flow_async():
    customerId = 1
    question = "tell me about your jackets"
    prompt = "context.prompty"

    response = await get_response_async(customerId, question, f"prompts/{prompt}")
    print(response)


def evaluate(prompt, evalprompt, customerId, question):
    response = get_response(customerId, question, prompt)

    result = prompty.execute(
        evalprompt,
        inputs=response,
    )
    return result


async def evaluate_async(prompt, evalprompt, customerId, question):
    response = await get_response_async(customerId, question, prompt)

    result = await prompty.execute_async(
        evalprompt,
        inputs=response,
    )
    return result


def test_context_groundedness():
    result = evaluate(
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
        1,
        "tell me about your jackets",
    )
    print(result)


@pytest.mark.asyncio
async def test_context_groundedness_async():
    result = await evaluate_async(
        "prompts/context.prompty",
        "prompts/groundedness.prompty",
        1,
        "tell me about your jackets",
    )
    print(result)


def test_embedding_headless():
    p = prompty.headless(
        api="embedding",
        configuration={"type": "azure", "azure_deployment": "text-embedding-ada-002"},
        content="hello world",
    )
    emb = prompty.execute(p)
    print(emb)


@pytest.mark.asyncio
async def test_embedding_headless_async():
    p = await prompty.headless_async(
        api="embedding",
        configuration={"type": "azure", "azure_deployment": "text-embedding-ada-002"},
        content="hello world",
    )
    emb = await prompty.execute_async(p)
    print(emb)


def test_embeddings_headless():
    p = prompty.headless(
        api="embedding",
        configuration={"type": "azure", "azure_deployment": "text-embedding-ada-002"},
        content=["hello world", "goodbye world", "hello again"],
    )
    emb = prompty.execute(p)
    print(emb)


@pytest.mark.asyncio
async def test_embeddings_headless_async():
    p = await prompty.headless_async(
        api="embedding",
        configuration={"type": "azure", "azure_deployment": "text-embedding-ada-002"},
        content=["hello world", "goodbye world", "hello again"],
    )
    emb = await prompty.execute_async(p)
    print(emb)


def test_function_calling():
    result = prompty.execute(
        "prompts/functions.prompty",
    )
    print(result)


@pytest.mark.asyncio
async def test_function_calling_async():
    result = await prompty.execute_async(
        "prompts/functions.prompty",
    )
    print(result)


# need to add trace attribute to
# materialize stream into the function
# trace decorator
def test_streaming():
    result = prompty.execute(
        "prompts/streaming.prompty",
    )
    for item in result:
        print(item)


@pytest.mark.asyncio
async def test_streaming_async():
    result = await prompty.execute_async(
        "prompts/streaming.prompty",
    )
    async for item in result:
        print(item)


def test_serverless():
    result = prompty.execute(
        "prompts/serverless.prompty",
        configuration={"key": os.environ.get("SERVERLESS_KEY", "key")},
    )
    print(result)


@pytest.mark.asyncio
async def test_serverless_async():
    result = await prompty.execute_async(
        "prompts/serverless.prompty",
        configuration={"key": os.environ.get("SERVERLESS_KEY", "key")},
    )
    print(result)


def test_serverless_streaming():
    result = prompty.execute(
        "prompts/serverless_stream.prompty",
        configuration={"key": os.environ.get("SERVERLESS_KEY", "key")},
    )
    for item in result:
        print(item)


@pytest.mark.asyncio
async def test_serverless_streaming_async():
    result = await prompty.execute_async(
        "prompts/serverless_stream.prompty",
        configuration={"key": os.environ.get("SERVERLESS_KEY", "key")},
    )

    async for item in result:
        print(item)
