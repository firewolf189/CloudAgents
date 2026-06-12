"""AgentScope 2.0 Demo - OpenAI Compatible (ZENMUX) Agent

Uses the Responses API (OpenAIResponseModel) for true streaming support.
"""

import asyncio
import os

from agentscope.agent import Agent
from agentscope.credential import OpenAICredential
from agentscope.event import EventType
from agentscope.message import UserMsg
from agentscope.model import OpenAIResponseModel
from agentscope.tool import Toolkit, Bash, Read, Write, Edit


async def main() -> None:
    agent = Agent(
        name="Friday",
        system_prompt="You are a helpful assistant named Friday.",
        model=OpenAIResponseModel(
            credential=OpenAICredential(
                api_key=os.getenv("ZENMUX_API_KEY"),
                base_url=os.getenv("ZENMUX_BASE_URL"),
            ),
            model="z-ai/glm-5.1",
        ),
        toolkit=Toolkit(tools=[Bash(), Read(), Write(), Edit()]),
    )

    user_msg = UserMsg(name="user", content="你好，请用中文简单介绍一下你自己")

    # Option 1: 直接获取最终回复
    print("=== Option 1: reply ===")
    reply_msg = await agent.reply(user_msg)
    for block in reply_msg.content:
        print(block)

    # Option 2: 流式输出事件
    print("\n=== Option 2: reply_stream ===")
    async for event in agent.reply_stream(user_msg):
        match event.type:
            case EventType.TEXT_BLOCK_DELTA:
                print(event.delta, end="", flush=True)
            case EventType.TEXT_BLOCK_END:
                print()
            case _:
                pass


if __name__ == "__main__":
    asyncio.run(main())
