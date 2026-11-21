from hashlib import sha256
from pathlib import Path

data = bytes(range(256)) * 4096
path = Path(__file__).with_name("workshop.bin")
path.write_bytes(data)
print(f"{sha256(data).hexdigest()}  {path.name}")
