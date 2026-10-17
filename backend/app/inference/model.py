"""Autoencoder architectures (trained only on normal sound; reconstruction error = anomaly score)."""
from __future__ import annotations

import torch
from torch import nn


def _block(i: int, o: int) -> list[nn.Module]:
    return [nn.Linear(i, o), nn.BatchNorm1d(o), nn.ReLU()]


class DenseAE(nn.Module):
    """DCASE 2020 Task 2 baseline shape: 640-128x4-8-128x4-640."""

    def __init__(self, dim: int, hidden: int = 128, bottleneck: int = 8):
        super().__init__()
        sizes = [dim, hidden, hidden, hidden, hidden, bottleneck, hidden, hidden, hidden, hidden]
        layers = [m for i, o in zip(sizes, sizes[1:]) for m in _block(i, o)]
        self.net = nn.Sequential(*layers, nn.Linear(hidden, dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class ConvAE(nn.Module):
    """Small convolutional AE over (patch frames × mels) log-mel patches. Experimental comparison."""

    def __init__(self, n_mels: int = 128, patch: int = 32):
        super().__init__()
        assert n_mels % 8 == 0 and patch % 8 == 0
        self.enc = nn.Sequential(
            nn.Conv2d(1, 16, 3, stride=2, padding=1), nn.BatchNorm2d(16), nn.ReLU(),
            nn.Conv2d(16, 32, 3, stride=2, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.Conv2d(32, 64, 3, stride=2, padding=1), nn.BatchNorm2d(64), nn.ReLU(),
        )
        self.dec = nn.Sequential(
            nn.ConvTranspose2d(64, 32, 4, stride=2, padding=1), nn.BatchNorm2d(32), nn.ReLU(),
            nn.ConvTranspose2d(32, 16, 4, stride=2, padding=1), nn.BatchNorm2d(16), nn.ReLU(),
            nn.ConvTranspose2d(16, 1, 4, stride=2, padding=1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.dec(self.enc(x))


def build_model(arch: str, cfg: dict) -> nn.Module:
    if arch == "dense":
        return DenseAE(cfg["frames"] * cfg["n_mels"])
    if arch == "conv":
        return ConvAE(cfg["n_mels"], cfg["patch"])
    raise ValueError(f"unknown arch {arch}")


def pick_device() -> torch.device:
    # On ROCm builds of PyTorch the AMD GPU is exposed through the "cuda" device API.
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def device_info() -> dict:
    info = {"torch": torch.__version__, "hip": getattr(torch.version, "hip", None), "cuda": torch.version.cuda,
            "device": "cpu"}
    if torch.cuda.is_available():
        info["device"] = torch.cuda.get_device_name(0)
    return info
