# 3D Home Scan Builder: COLMAP (where each photo was taken) + OpenSplat (training the splat), on the CPU.
# Home Assistant's Debian base for the architecture the Supervisor builds for (it passes BUILD_ARCH; BUILD_FROM wins
# when given, as for a plain `docker build --build-arg BUILD_FROM=debian:bookworm`).
ARG BUILD_ARCH=amd64
ARG BUILD_FROM=ghcr.io/home-assistant/${BUILD_ARCH}-base-debian:bookworm
FROM ${BUILD_FROM}

ARG OPENSPLAT_VERSION=v1.2.2
# 2.7 is the first release whose wheels use the C++11 ABI, like Debian's OpenCV that OpenSplat links with too
ARG TORCH_VERSION=2.7.1

# system packages: COLMAP, OpenCV and the compilers (kept: they are small next to PyTorch)
RUN apt-get update && apt-get install -y --no-install-recommends \
        colmap python3 python3-pip git cmake build-essential libopencv-dev \
    && rm -rf /var/lib/apt/lists/*

# PyTorch for the CPU. PyPI stays the main index (torch's own dependencies come from there); the CPU build comes from
# PyTorch's index, named exactly so the CUDA build on PyPI isn't picked (x86 only: on ARM PyPI's build is the CPU one).
RUN if [ "$(uname -m)" = "x86_64" ]; then TORCH="torch==${TORCH_VERSION}+cpu"; else TORCH="torch==${TORCH_VERSION}"; fi \
    && pip3 install --no-cache-dir --break-system-packages \
        --extra-index-url https://download.pytorch.org/whl/cpu "${TORCH}"

# OpenSplat, built for the CPU against that PyTorch
RUN git clone --depth 1 --branch ${OPENSPLAT_VERSION} https://github.com/pierotofy/OpenSplat /tmp/OpenSplat \
    && cmake -S /tmp/OpenSplat -B /tmp/OpenSplat/build -DCMAKE_BUILD_TYPE=Release -DGPU_RUNTIME=CPU \
        -DCMAKE_PREFIX_PATH="$(python3 -c 'import torch; print(torch.utils.cmake_prefix_path)')" \
    && cmake --build /tmp/OpenSplat/build -j"$(nproc)" \
    && install -m 755 /tmp/OpenSplat/build/opensplat /usr/local/bin/opensplat \
    && rm -rf /tmp/OpenSplat

# OpenSplat links against the libtorch inside the torch wheel
RUN echo "$(python3 -c 'import torch, os; print(os.path.join(os.path.dirname(torch.__file__), "lib"))')" \
        > /etc/ld.so.conf.d/torch.conf && ldconfig

# COLMAP is a Qt program: no display here
ENV QT_QPA_PLATFORM=offscreen

COPY server.py /server.py
CMD ["python3", "/server.py"]
