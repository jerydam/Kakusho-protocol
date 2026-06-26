import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const TREE_PATH = join(process.cwd(), 'public/restricted_tree.json');

const SCRIPT_PATH =
  process.env.Kakusho_CIRCUITS_PATH ||
  join(process.cwd(), '../circuits/scripts/build_restricted_tree.js');

// GET — serves the pre-built static tree (used by frontend)
export async function GET(_req: NextRequest) {
  try {
    const raw = await readFile(TREE_PATH, 'utf-8');
    const tree = JSON.parse(raw);
    const rootHex = BigInt(tree.root).toString(16).padStart(64, '0');
    return NextResponse.json({ ...tree, root_hex: rootHex });
  } catch (e: any) {
    return NextResponse.json(
      {
        detail:
          'Restricted tree not found. Run: node circuits/scripts/build_restricted_tree.js ' +
          'circuits/restricted_codes.json frontend/public/restricted_tree.json',
      },
      { status: 500 }
    );
  }
}

// POST — builds a tree at runtime from a custom codes array.
// Used by admin tooling / contract deployment; not called by the browser UI.
export async function POST(req: NextRequest) {
  const { codes } = await req.json();

  if (!Array.isArray(codes) || codes.length === 0) {
    return NextResponse.json({ detail: 'codes array required' }, { status: 400 });
  }

  if (codes.some((c) => typeof c !== 'number' || c < 1 || c > 999999)) {
    return NextResponse.json(
      { detail: 'All codes must be numbers between 1 and 999999' },
      { status: 400 }
    );
  }

  const ts = Date.now();
  const inputPath  = join(tmpdir(), `Kakusho_codes_${ts}.json`);
  const outputPath = join(tmpdir(), `Kakusho_tree_${ts}.json`);

  try {
    await writeFile(inputPath, JSON.stringify(codes));

    await new Promise<void>((resolve, reject) => {
      execFile(
        'node',
        [SCRIPT_PATH, inputPath, outputPath],
        { timeout: 30_000 },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message));
          else resolve();
        }
      );
    });

    const result = await readFile(outputPath, 'utf-8');
    const tree = JSON.parse(result);

    const rootHex = BigInt(tree.root).toString(16).padStart(64, '0');

    return NextResponse.json({ ...tree, root_hex: rootHex });
  } catch (e: any) {
    return NextResponse.json({ detail: e.message }, { status: 500 });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}