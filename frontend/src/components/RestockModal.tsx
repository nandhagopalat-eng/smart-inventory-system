import { useState, type FormEvent } from 'react';

import { api, ApiError } from '../api/client';
import { ErrorNote } from './ui';

export const RestockModal = ({
  productId,
  productName,
  suggestedQuantity,
  onClose,
  onDone,
}: {
  productId: string;
  productName: string;
  suggestedQuantity: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) => {
  const [quantity, setQuantity] = useState(Math.max(1, suggestedQuantity));
  const [note, setNote] = useState('Purchase order received');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.createMovement({
        productId,
        movementType: 'in',
        quantityChange: quantity,
        reason: 'purchase',
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone(`Recorded ${quantity} units received for ${productName}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stock could not be recorded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <p className="form-note field-span">
        Record a purchase for <strong>{productName}</strong>. This increases stock and writes an
        audited `purchase` movement.
      </p>
      <label className="field">
        <span>Quantity received</span>
        <input
          type="number"
          min={1}
          step={1}
          required
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
      </label>
      <label className="field">
        <span>Note</span>
        <input maxLength={250} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error ? <div className="field-span"><ErrorNote>{error}</ErrorNote></div> : null}
      <div className="form-actions field-span">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Recording…' : 'Record purchase'}
        </button>
      </div>
    </form>
  );
};
