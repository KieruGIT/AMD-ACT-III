"""PANNs CNN14 (16 kHz) as a frozen, pretrained audio encoder. We do NOT train it.

Architecture and preprocessing follow the official code (github.com/qiuqiangkong/audioset_tagging_cnn,
pytorch/models.py `Cnn14_16k`) so the released AudioSet weights load strictly:
    Kong et al., "PANNs: Large-Scale Pretrained Audio Neural Networks for Audio Pattern Recognition", 2020.
    Weights: Cnn14_16k_mAP=0.438.pth, https://zenodo.org/records/3987831 (CC BY 4.0)

Input: mono float32 at 16 kHz in [-1, 1]. Preprocessing (inside the model, as upstream): 512-pt Hann STFT,
160 hop, 64 mels 50–8000 Hz, log power. Outputs two 2048-d vectors per window:
    "pooled" = global time/frequency pooling of the last conv block (before fc1)
    "fc1"    = relu(fc1(pooled)), the vector upstream calls `embedding`
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

LAYERS = ("pooled", "fc1")
CHECKPOINT_URL = "https://zenodo.org/records/3987831/files/Cnn14_16k_mAP%3D0.438.pth?download=1"
# sha256 of the official file (its md5 matches the one Zenodo publishes: 362fc5ff18f1d6ad2f6d464b45893f2c).
# It is a legacy pickle that also stores numpy arrays, so weights_only loading cannot read it; we unpickle it
# fully ONLY when the bytes match this hash. Any other file must be a plain state dict (weights_only=True).
OFFICIAL_SHA256 = "e2ee543a27919542c2ea03eabaa70b24dcd4e6c8e05621de6b67a94e4c5058e6"
# sample_rate, window_size, hop_size, mel_bins, fmin, fmax, as fixed by upstream Cnn14_16k
FRONTEND = {"sample_rate": 16_000, "window_size": 512, "hop_size": 160, "mel_bins": 64, "fmin": 50, "fmax": 8_000}


class ConvBlock(nn.Module):
    def __init__(self, i: int, o: int):
        super().__init__()
        self.conv1 = nn.Conv2d(i, o, kernel_size=3, stride=1, padding=1, bias=False)
        self.conv2 = nn.Conv2d(o, o, kernel_size=3, stride=1, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(o)
        self.bn2 = nn.BatchNorm2d(o)

    def forward(self, x: torch.Tensor, pool: tuple[int, int]) -> torch.Tensor:
        x = F.relu_(self.bn1(self.conv1(x)))
        x = F.relu_(self.bn2(self.conv2(x)))
        return F.avg_pool2d(x, kernel_size=pool)


class Cnn14_16k(nn.Module):
    def __init__(self, classes_num: int = 527):
        super().__init__()
        from torchlibrosa.stft import LogmelFilterBank, Spectrogram

        f = FRONTEND
        self.spectrogram_extractor = Spectrogram(n_fft=f["window_size"], hop_length=f["hop_size"],
                                                 win_length=f["window_size"], window="hann", center=True,
                                                 pad_mode="reflect", freeze_parameters=True)
        self.logmel_extractor = LogmelFilterBank(sr=f["sample_rate"], n_fft=f["window_size"], n_mels=f["mel_bins"],
                                                 fmin=f["fmin"], fmax=f["fmax"], ref=1.0, amin=1e-10, top_db=None,
                                                 freeze_parameters=True)
        self.bn0 = nn.BatchNorm2d(64)
        self.conv_block1 = ConvBlock(1, 64)
        self.conv_block2 = ConvBlock(64, 128)
        self.conv_block3 = ConvBlock(128, 256)
        self.conv_block4 = ConvBlock(256, 512)
        self.conv_block5 = ConvBlock(512, 1024)
        self.conv_block6 = ConvBlock(1024, 2048)
        self.fc1 = nn.Linear(2048, 2048, bias=True)
        self.fc_audioset = nn.Linear(2048, classes_num, bias=True)

    def forward(self, wav: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        """(B, samples) → (pooled, fc1), each (B, 2048). Inference only: dropout/SpecAugment are omitted."""
        x = self.logmel_extractor(self.spectrogram_extractor(wav))  # (B, 1, T, mels)
        x = self.bn0(x.transpose(1, 3)).transpose(1, 3)
        for block in (self.conv_block1, self.conv_block2, self.conv_block3, self.conv_block4, self.conv_block5):
            x = block(x, (2, 2))
        x = self.conv_block6(x, (1, 1))
        x = torch.mean(x, dim=3)
        pooled = torch.max(x, dim=2)[0] + torch.mean(x, dim=2)
        return pooled, F.relu_(self.fc1(pooled))


def file_sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class PannsEmbedder:
    """Frozen CNN14 on the best available device (ROCm/CUDA GPU, else CPU)."""

    name = "panns-cnn14-16k"

    def __init__(self, checkpoint: str | Path, device: torch.device | None = None):
        from .model import pick_device

        self.sha256 = file_sha256(checkpoint)
        state = torch.load(checkpoint, map_location="cpu", weights_only=self.sha256 != OFFICIAL_SHA256)
        model = Cnn14_16k()
        model.load_state_dict(state.get("model", state))  # strict: any architecture mismatch fails loudly
        self.device = device or pick_device()
        self.model = model.to(self.device).eval()

    @torch.no_grad()
    def embed_batch(self, wavs: np.ndarray) -> dict[str, np.ndarray]:
        """(B, samples) float32 at 16 kHz → {"pooled": (B, 2048), "fc1": (B, 2048)} float32."""
        x = torch.from_numpy(np.ascontiguousarray(wavs, dtype=np.float32)).to(self.device)
        pooled, fc1 = self.model(x)
        return {"pooled": pooled.cpu().numpy(), "fc1": fc1.cpu().numpy()}
