# 3D Home Scan Builder: COLMAP (where each photo was taken) + OpenSplat (training the splat), on the CPU.
# The base image comes from build.yaml (Home Assistant's Debian base for each architecture).
ARG BUILD_FROM
FROM ${BUILD_FROM}

ARG OPENSPLAT_VERSION=v1.2.2
# 2.7 is the first release whose wheels use the C++11 ABI, like Debian's OpenCV that OpenSplat links with too
ARG TORCH_VERSION=2.7.1

RUN apt-get update && apt-get install -y --no-install-recommends \
        colmap python3 python3-pip git cmake build-essential libopencv-dev \
    && pip3 install --no-cache-dir --break-system-packages \
        torch==${TORCH_VERSION} --index-url https://download.pytorch.org/whl/cpu \
    && git clone --depth 1 --branch ${OPENSPLAT_VERSION} https://github.com/pierotofy/OpenSplat /tmp/OpenSplat \
    && cmake -S /tmp/OpenSplat -B /tmp/OpenSplat/build -DCMAKE_BUILD_TYPE=Release -DGPU_RUNTIME=CPU \
        -DCMAKE_PREFIX_PATH="$(python3 -c 'import torch; print(torch.utils.cmake_prefix_path)')" \
    && cmake --build /tmp/OpenSplat/build -j"$(nproc)" \
    && install -m 755 /tmp/OpenSplat/build/opensplat /usr/local/bin/opensplat \
    && rm -rf /tmp/OpenSplat /var/lib/apt/lists/* \
    && apt-get purge -y git cmake build-essential && apt-get autoremove -y

# OpenSplat links against the libtorch inside the torch wheel
RUN echo "$(python3 -c 'import torch, os; print(os.path.join(os.path.dirname(torch.__file__), "lib"))')" \
        > /etc/ld.so.conf.d/torch.conf && ldconfig

COPY server.py /server.py
CMD ["python3", "/server.py"]
