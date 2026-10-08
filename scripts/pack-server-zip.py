import os
import zipfile
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

def main():
    root = r"E:\Workbox\sp-upgrade-2.1"
    tar_file = os.path.join(root, "stronghold-v0.2.1-fusion-server-release.tar.gz")
    doc_file = os.path.join(root, "部署教学与运维手册.txt")
    out_zip = r"E:\Workbox\鸢-0.2.1 服务器.zip"
    
    assert os.path.exists(tar_file), f"Missing {tar_file}"
    assert os.path.exists(doc_file), f"Missing {doc_file}"
    
    tmp_zip = out_zip + ".tmp"
    if os.path.exists(tmp_zip): os.remove(tmp_zip)
    
    with zipfile.ZipFile(tmp_zip, 'w', compression=zipfile.ZIP_STORED) as z:
        for fpath in [tar_file, doc_file]:
            arcname = os.path.basename(fpath)
            info = zipfile.ZipInfo.from_file(fpath, arcname)
            info.flag_bits |= 0x800  # UTF-8
            with open(fpath, 'rb') as fp:
                z.writestr(info, fp.read())
            print(f"  + 添加: {arcname} ({os.path.getsize(fpath) / (1024*1024):.2f} MB)")
            
    if os.path.exists(out_zip): os.remove(out_zip)
    os.rename(tmp_zip, out_zip)
    print(f"\n[OK] 服务器部署合辑打包完成: {out_zip} ({os.path.getsize(out_zip) / (1024*1024):.2f} MB)")

if __name__ == "__main__":
    main()
