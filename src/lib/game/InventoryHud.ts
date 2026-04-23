import { Inventory, blockLabel } from './Inventory';
import { BLOCK_TEXTURES } from './voxel/BlockTypes';
import { getTileDataUrl } from './voxel/TextureGenerator';

export class InventoryHud {
  private readonly root: HTMLDivElement;
  private readonly slotEls: HTMLDivElement[] = [];
  private lastSignature = '';

  constructor(container: HTMLElement, private readonly inventory: Inventory) {
    this.root = document.createElement('div');
    this.root.style.position = 'absolute';
    this.root.style.left = '50%';
    this.root.style.bottom = '20px';
    this.root.style.transform = 'translateX(-50%)';
    this.root.style.display = 'flex';
    this.root.style.gap = '4px';
    this.root.style.padding = '6px';
    this.root.style.background = 'rgba(0, 0, 0, 0.55)';
    this.root.style.borderRadius = '8px';
    this.root.style.pointerEvents = 'none';
    this.root.style.zIndex = '6';
    this.root.style.font = '11px/1.2 Arial, sans-serif';
    this.root.style.userSelect = 'none';

    for (let i = 0; i < inventory.size(); i++) {
      const cell = document.createElement('div');
      cell.style.width = '48px';
      cell.style.height = '48px';
      cell.style.borderRadius = '4px';
      cell.style.border = '2px solid rgba(255,255,255,0.3)';
      cell.style.background = 'rgba(255,255,255,0.06)';
      cell.style.display = 'flex';
      cell.style.flexDirection = 'column';
      cell.style.alignItems = 'center';
      cell.style.justifyContent = 'center';
      cell.style.color = 'white';
      cell.style.position = 'relative';
      cell.style.overflow = 'hidden';

      const number = document.createElement('div');
      number.textContent = String(i + 1);
      number.style.position = 'absolute';
      number.style.top = '2px';
      number.style.left = '4px';
      number.style.fontSize = '9px';
      number.style.opacity = '0.6';
      cell.appendChild(number);

      this.slotEls.push(cell);
      this.root.appendChild(cell);
    }

    container.appendChild(this.root);
  }

  public render(): void {
    const signature = this.signature();
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const selected = this.inventory.getSelectedIndex();
    for (let i = 0; i < this.slotEls.length; i++) {
      const cell = this.slotEls[i];
      const slot = this.inventory.getSlot(i);

      cell.style.borderColor = i === selected ? '#ffe03d' : 'rgba(255,255,255,0.3)';
      cell.style.boxShadow = i === selected ? '0 0 8px rgba(255,224,61,0.6)' : 'none';

      // Remove any previous content except the slot number (first child).
      while (cell.childNodes.length > 1) cell.removeChild(cell.lastChild!);

      if (!slot) continue;

      const iconBox = document.createElement('div');
      iconBox.style.width = '28px';
      iconBox.style.height = '28px';
      iconBox.style.borderRadius = '3px';
      iconBox.style.display = 'flex';
      iconBox.style.alignItems = 'center';
      iconBox.style.justifyContent = 'center';
      iconBox.style.fontSize = '10px';
      iconBox.style.fontWeight = 'bold';

      if (slot.item.kind === 'tool') {
        iconBox.style.background = slot.item.tool === 'pickaxe' ? '#5b6775' : '#7a5a2e';
        iconBox.textContent = slot.item.tool === 'pickaxe' ? 'PICK' : 'AXE';
      } else {
        const tex = BLOCK_TEXTURES[slot.item.block];
        const layer = tex ? tex.side : 0;
        iconBox.style.width = '32px';
        iconBox.style.height = '32px';
        iconBox.style.backgroundImage = `url(${getTileDataUrl(layer)})`;
        iconBox.style.backgroundSize = '100% 100%';
        iconBox.style.backgroundRepeat = 'no-repeat';
        iconBox.style.imageRendering = 'pixelated';
        iconBox.style.border = '1px solid rgba(0,0,0,0.4)';
        iconBox.textContent = '';
        iconBox.title = blockLabel(slot.item.block);
      }
      cell.appendChild(iconBox);

      if (slot.count > 1) {
        const count = document.createElement('div');
        count.textContent = String(slot.count);
        count.style.position = 'absolute';
        count.style.bottom = '2px';
        count.style.right = '4px';
        count.style.fontSize = '11px';
        count.style.fontWeight = 'bold';
        count.style.textShadow = '1px 1px 2px rgba(0,0,0,0.9)';
        cell.appendChild(count);
      }
    }
  }

  private signature(): string {
    const parts: string[] = [String(this.inventory.getSelectedIndex())];
    for (let i = 0; i < this.inventory.size(); i++) {
      const s = this.inventory.getSlot(i);
      if (!s) { parts.push('-'); continue; }
      if (s.item.kind === 'tool') parts.push(`t:${s.item.tool}`);
      else parts.push(`b:${s.item.block}x${s.count}`);
    }
    return parts.join('|');
  }
}
