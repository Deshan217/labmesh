"""Forward this laptop's loopback endpoint to the coordinator on the workshop LAN."""
import asyncio
import sys


async def pipe(reader, writer):
    while data := await reader.read(65536):
        writer.write(data)
        await writer.drain()


async def create_forwarder(remote_host, remote_port=8765, local_host="127.0.0.1", local_port=8765):
    async def handle(reader, writer):
        remote = None
        tasks = []
        try:
            upstream, remote = await asyncio.wait_for(asyncio.open_connection(remote_host, remote_port), 8)
            tasks = [asyncio.create_task(pipe(reader, remote)), asyncio.create_task(pipe(upstream, writer))]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        except OSError as exc:
            print(f"Coordinator unavailable: {exc}")
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for stream in (remote, writer):
                if stream:
                    stream.close()
    return await asyncio.start_server(handle, local_host, local_port)


async def main(host, port=8765):
    server = await create_forwarder(host, port, "127.0.0.1", 8765)
    print(f"Loopback port 8765 -> {host}:{port}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit("Usage: python server/forward.py COORDINATOR_LAN_IP [PORT]")
    port = int(sys.argv[2]) if len(sys.argv) == 3 else 8765
    asyncio.run(main(sys.argv[1], port))
