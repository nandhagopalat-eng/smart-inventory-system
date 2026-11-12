import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

import { ErrorNote } from './ui';

export const BarcodeScanner = ({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | null = null;
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result && !cancelled) {
          cancelled = true;
          controls?.stop();
          onDetected(result.getText());
        }
      })
      .then((scannerControls) => {
        if (cancelled) {
          scannerControls.stop();
          return;
        }
        controls = scannerControls;
        setReady(true);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof Error
            ? `Camera unavailable: ${err.message}`
            : 'Camera unavailable. Enter the barcode manually.'
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [onDetected]);

  return (
    <div className="scanner">
      <div className="scanner-frame">
        <video ref={videoRef} className="scanner-video" muted playsInline />
        {!ready && !error ? <p className="scanner-status">Starting camera…</p> : null}
        <span className="scanner-reticle" aria-hidden="true" />
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <p className="scanner-help">
        Point the camera at a product barcode. Scanning stops after the first match.
      </p>
      <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>
        Cancel scanning
      </button>
    </div>
  );
};
