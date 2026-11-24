# 3D Home helper with COLMAP and OpenSplat, OpenSplat built for NVIDIA graphics cards (CUDA).
#
#   docker build -t ha3dhome-helper http://<home assistant>:8123/api/ha_3dhome_scan/helper/files/helper.tar.gz
#   docker run --rm --gpus all ha3dhome-helper --url http://<home assistant>:8123 --page <id> --key <key> --name "$(hostname)"
#
# Needs Docker with the NVIDIA Container Toolkit (for --gpus all). Building takes a while (OpenSplat compiles for every
# recent NVIDIA generation); it is done once.
# CUDA 12.8: the first that compiles for RTX 50xx (Blackwell, compute 12.0)
FROM nvidia/cuda:12.8.1-devel-ubuntu22.04

ARG OPENSPLAT_VERSION=v1.2.2
ARG TORCH_VERSION=2.7.1
# Turing (RTX 20xx) to Blackwell (RTX 50xx). Building for fewer is faster: --build-arg CUDA_ARCHITECTURES=89 (RTX 40xx)
ARG CUDA_ARCHITECTURES="75;80;86;89;90;120"

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
        colmap python3 python3-pip git cmake build-essential libopencv-dev \
    && rm -rf /var/lib/apt/lists/*

# PyTorch built for CUDA 12.8, which OpenSplat links against
RUN pip3 install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cu128 "torch==${TORCH_VERSION}+cu128"

RUN git clone --depth 1 --branch ${OPENSPLAT_VERSION} https://github.com/pierotofy/OpenSplat /tmp/OpenSplat \
    && cmake -S /tmp/OpenSplat -B /tmp/OpenSplat/build -DCMAKE_BUILD_TYPE=Release -DGPU_RUNTIME=CUDA \
        -DCMAKE_CUDA_ARCHITECTURES="${CUDA_ARCHITECTURES}" \
        -DCMAKE_PREFIX_PATH="$(python3 -c 'import torch; print(torch.utils.cmake_prefix_path)')" \
    && cmake --build /tmp/OpenSplat/build -j"$(nproc)" \
    && install -m 755 /tmp/OpenSplat/build/opensplat /usr/local/bin/opensplat \
    && rm -rf /tmp/OpenSplat \
    && echo "$(python3 -c 'import torch, os; print(os.path.join(os.path.dirname(torch.__file__), "lib"))')" \
        > /etc/ld.so.conf.d/torch.conf && ldconfig

# COLMAP is a Qt program: no display here
ENV QT_QPA_PLATFORM=offscreen

COPY ha3dhome_helper.py /ha3dhome_helper.py
ENTRYPOINT ["python3", "/ha3dhome_helper.py"]
