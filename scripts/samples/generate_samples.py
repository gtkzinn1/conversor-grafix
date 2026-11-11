"""Gera os PDFs de teste de tests/samples/ (sem dados de clientes).

Uso (na raiz do projeto, Python 3.10+ e pikepdf 10.0.2):
    python -I scripts/samples/generate_samples.py

Cada arquivo imita uma situação real que o "Corrigir PDF para o Corel" precisa tratar.
O resultado é determinístico (IDs fixos), para não mudar o repositório à toa.
"""

from __future__ import annotations

import zlib
from pathlib import Path

import pikepdf
from pikepdf import Array, Dictionary, Name, Pdf, Stream, String

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "tests" / "samples"
FIXED_ID = [b"conversor-grafix", b"conversor-grafix"]


def new_pdf(width: float = 595, height: float = 842, origin_y: float = 0) -> Pdf:
    pdf = Pdf.new()
    pdf.add_blank_page(page_size=(width, height))
    page = pdf.pages[0]
    page.obj.MediaBox = Array([0, origin_y, width, height + origin_y])
    return pdf


def font(pdf: Pdf) -> pikepdf.Object:
    return pdf.make_indirect(
        Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica, Encoding=Name.WinAnsiEncoding)
    )


def save(pdf: Pdf, name: str, **kwargs) -> None:
    pdf.trailer.ID = Array([String(FIXED_ID[0]), String(FIXED_ID[1])])
    pdf.save(OUT / name, deterministic_id=False, static_id=True, **kwargs)
    print("gerado", name)


def canva_tags() -> None:
    """Estrutura típica do Canva: tags com /Limits na raiz do ParentTree (causa do erro no Corel)."""
    pdf = new_pdf(612, 792, origin_y=7.92)
    page = pdf.pages[0]
    smask = pdf.make_stream(
        bytes(range(0, 256, 4)), Type=Name.XObject, Subtype=Name.Image, Width=8, Height=8,
        ColorSpace=Name.DeviceGray, BitsPerComponent=8,
    )
    image = pdf.make_stream(
        bytes([0, 128, 255] * 64), Type=Name.XObject, Subtype=Name.Image, Width=8, Height=8,
        ColorSpace=Name.DeviceRGB, BitsPerComponent=8, SMask=smask, StructParent=1,
    )
    group = pdf.make_stream(
        b"q 1 1 1 rg 0 0 612 792 re f Q",
        Type=Name.XObject, Subtype=Name.Form, BBox=[0, 0, 612, 792],
        Group=Dictionary(Type=Name.Group, S=Name.Transparency, I=True),
    )
    page.obj.Resources = Dictionary(
        Font=Dictionary(F1=font(pdf)),
        XObject=Dictionary(Im1=image, Fx1=group),
        ExtGState=Dictionary(Invisivel=Dictionary(Type=Name.ExtGState, ca=0.0)),
    )
    page.obj.StructParents = 0
    page.obj.Tabs = Name.S
    page.obj.Contents = pdf.make_stream(
        b"q 0.24 0 0 -0.24 0 799.92 cm /Artifact BMC /Fx1 Do EMC Q\n"
        b"/P <</MCID 0>> BDC BT /F1 24 Tf 72 700 Td (Menu de teste) Tj ET EMC\n"
        b"/Figure <</MCID 1>> BDC q 100 0 0 100 72 500 cm /Im1 Do Q EMC\n"
        b"/Invisivel gs 0 0 0 rg 0 0 300 400 re f\n"
    )
    para = pdf.make_indirect(Dictionary(Type=Name.StructElem, S=Name.P, K=0, Pg=page.obj))
    figure = pdf.make_indirect(Dictionary(Type=Name.StructElem, S=Name.Figure, K=1, Pg=page.obj))
    document = pdf.make_indirect(Dictionary(Type=Name.StructElem, S=Name.Document, K=Array([para, figure])))
    para.P = document
    figure.P = document
    parent_tree = Dictionary(Nums=Array([0, Array([para, figure]), 1, figure]), Limits=Array([0, 1]))
    pdf.Root.StructTreeRoot = pdf.make_indirect(
        Dictionary(Type=Name.StructTreeRoot, K=document, ParentTree=parent_tree, ParentTreeNextKey=2,
                   IDTree=Dictionary(Names=Array([])))
    )
    document.P = pdf.Root.StructTreeRoot
    pdf.Root.MarkInfo = Dictionary(Marked=True)
    pdf.Root.Lang = String("pt-BR")
    pdf.Root.Version = Name("/1.4")
    pdf.Root.ViewerPreferences = Dictionary(DisplayDocTitle=True)
    outline = pdf.make_indirect(Dictionary(Title=String("Menu"), Dest=Array([page.obj, Name.Fit])))
    pdf.Root.Outlines = pdf.make_indirect(Dictionary(Type=Name.Outlines, First=outline, Last=outline, Count=1))
    outline.Parent = pdf.Root.Outlines
    pdf.docinfo.Producer = "Amostra sintética no estilo Canva"
    save(pdf, "canva-tags.pdf", min_version="1.4")


def exp_function(c0: list[float], c1: list[float], n: float = 1) -> Dictionary:
    return Dictionary(FunctionType=2, Domain=[0, 1], C0=c0, C1=c1, N=n)


def degrades() -> None:
    """Degradês em todas as formas que a troca trata (e algumas que ela mantém com aviso)."""
    pdf = new_pdf()
    page = pdf.pages[0]
    stitching = Dictionary(
        FunctionType=3, Domain=[0, 1], Bounds=[0.5], Encode=[0, 1, 0, 1],
        Functions=[exp_function([0, 0, 0, 0], [0, 1, 1, 0]), exp_function([0, 1, 1, 0], [0, 1, 1, 0.34])],
    )
    postscript = pdf.make_stream(b"{ 0.5 mul 0.25 add }", FunctionType=4, Domain=[0, 1], Range=[0, 1])
    sampled = pdf.make_stream(
        bytes([255, 0, 0, 0, 0, 255]), FunctionType=0, Domain=[0, 1], Range=[0, 1, 0, 1, 0, 1],
        Size=[2], BitsPerSample=8,
    )
    separation = Array([Name.Separation, Name("/PANTONE 186 C"), Name.DeviceCMYK,
                        exp_function([0, 0, 0, 0], [0, 1, 0.8, 0.1])])
    shadings = Dictionary(
        Sh1=pdf.make_indirect(Dictionary(ShadingType=2, ColorSpace=Name.DeviceCMYK, Coords=[0, 0, 100, 0],
                                         Function=stitching)),
        Sh2=Dictionary(ShadingType=3, ColorSpace=Name.DeviceRGB, Coords=[50, 50, 0, 50, 50, 50],
                       Function=exp_function([1, 1, 1], [0, 0, 1])),
        Sh3=Dictionary(ShadingType=2, ColorSpace=Name.DeviceGray, Coords=[0, 0, 100, 0], Function=postscript),
        Sh4=Dictionary(ShadingType=2, ColorSpace=separation, Coords=[0, 0, 100, 0],
                       Function=exp_function([0], [1])),
        Sh5=Dictionary(ShadingType=2, ColorSpace=Name.DeviceRGB, Coords=[0, 0, 100, 0], Function=sampled),
        Sh6=Dictionary(ShadingType=1, ColorSpace=Name.DeviceGray, Domain=[0, 1, 0, 1],
                       Function=pdf.make_stream(b"{ add 0.5 mul }", FunctionType=4, Domain=[0, 1, 0, 1],
                                                Range=[0, 1])),
        Sh7=Dictionary(ShadingType=2, ColorSpace=Name.DeviceRGB, Coords=[0, 0, 595, 0],
                       Function=exp_function([1, 1, 0], [1, 0, 0])),
        # Malha de triângulos (tipo 4): sem média calculável, usa o /Background.
        Sh8=pdf.make_stream(
            bytes([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 128, 255, 0, 0, 255]),
            ShadingType=4, ColorSpace=Name.DeviceRGB, BitsPerCoordinate=8, BitsPerComponent=8,
            BitsPerFlag=8, Decode=[0, 100, 0, 100, 0, 1, 0, 1, 0, 1], Background=[0, 0, 1],
        ),
    )
    form = pdf.make_stream(
        b"q 0 0 80 80 re W n /Sh2 sh Q",
        Type=Name.XObject, Subtype=Name.Form, BBox=[0, 0, 80, 80],
        Resources=Dictionary(Shading=Dictionary(Sh2=shadings.Sh2)),
    )
    page.obj.Resources = Dictionary(
        Shading=shadings,
        Pattern=Dictionary(P1=Dictionary(PatternType=2, Shading=shadings.Sh1)),
        XObject=Dictionary(Fm1=form),
        Font=Dictionary(F1=font(pdf)),
    )
    first = (
        b"% fundo: sh sem recorte, com escala (pinta a pagina toda)\n"
        b"q 0.5 0 0 0.5 0 0 cm /Sh7 sh Q\n"
        b"% degrades com recorte (tecnica validada)\n"
        b"q 1 0 0 1 50 650 cm 0 0 100 100 re W n /Sh1 sh Q\n"
        b"q 200 650 m 300 650 l 300 750 l h W* n 1 0 0 1 200 650 cm /Sh2 sh Q\n"
        b"q 50 500 100 100 re W n /Sh3 sh 0 0 1 rg 60 510 10 10 re f Q\n"
    )
    second = (
        b"q 200 500 100 100 re W n /Sh4 sh Q\n"
        b"q 350 500 100 100 re W n /Sh5 sh Q\n"
        b"q 350 650 100 100 re W n /Sh6 sh Q\n"
        b"q 50 200 50 50 re W n /Sh8 sh Q\n"
        b"q /Pattern cs /P1 scn 50 350 100 100 re f Q\n"
        b"BT /F1 12 Tf 50 300 Td (texto \\(com par\\352nteses\\) e sh no meio) Tj ET\n"
        b"q 20 0 0 20 400 300 cm BI /W 2 /H 2 /CS /G /BPC 8 ID \x00sh) EI Q\n"
        b"q 1 0 0 1 200 300 cm /Fm1 Do Q\n"
    )
    page.obj.Contents = Array([pdf.make_stream(first), pdf.make_stream(second)])
    save(pdf, "degrades.pdf", min_version="1.4")


def active_content() -> None:
    """JavaScript, ações automáticas, ação Launch e anexo embutido."""
    pdf = new_pdf()
    page = pdf.pages[0]
    page.obj.Resources = Dictionary(Font=Dictionary(F1=font(pdf)))
    page.obj.Contents = pdf.make_stream(b"BT /F1 18 Tf 72 760 Td (Conteudo ativo) Tj ET")
    js = pdf.make_indirect(Dictionary(S=Name.JavaScript, JS=String("app.alert('oi');")))
    pdf.Root.OpenAction = js
    pdf.Root.AA = Dictionary(WC=Dictionary(S=Name.JavaScript, JS=String("1;")))
    attachment = pdf.make_stream(b"arquivo anexo", Type=Name.EmbeddedFile)
    filespec = pdf.make_indirect(Dictionary(Type=Name.Filespec, F=String("anexo.txt"),
                                            EF=Dictionary(F=attachment)))
    pdf.Root.Names = Dictionary(
        JavaScript=Dictionary(Names=Array([String("js"), js])),
        EmbeddedFiles=Dictionary(Names=Array([String("anexo.txt"), filespec])),
    )
    launch = pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Link, Rect=[72, 700, 200, 720],
                                          A=Dictionary(S=Name.Launch, F=String("calc.exe"))))
    site = pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Link, Rect=[72, 670, 200, 690],
                                        A=Dictionary(S=Name.URI, URI=String("https://example.com"))))
    clip = pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.FileAttachment, Rect=[72, 640, 90, 660],
                                        FS=filespec))
    page.obj.Annots = Array([launch, site, clip])
    page.obj.AA = Dictionary(O=Dictionary(S=Name.JavaScript, JS=String("1;")))
    save(pdf, "conteudo-ativo.pdf", min_version="1.4")


def simple(text: str) -> Pdf:
    pdf = new_pdf()
    page = pdf.pages[0]
    page.obj.Resources = Dictionary(Font=Dictionary(F1=font(pdf)))
    page.obj.Contents = pdf.make_stream(f"BT /F1 18 Tf 72 760 Td ({text}) Tj ET".encode("latin-1"))
    return pdf


def protected() -> None:
    restricted = simple("Protegido contra edicao")
    save(restricted, "protegido-sem-senha.pdf",
         encryption=pikepdf.Encryption(owner="dono", user="", R=6,
                                       allow=pikepdf.Permissions(extract=False, modify_other=False)))
    locked = simple("Com senha de abertura")
    save(locked, "senha-grafix.pdf", encryption=pikepdf.Encryption(owner="dono", user="grafix", R=6))


def object_streams() -> None:
    pdf = simple("PDF 1.7 com object streams")
    pdf.add_blank_page(page_size=(842, 595))
    save(pdf, "object-streams-1.7.pdf", min_version="1.7",
         object_stream_mode=pikepdf.ObjectStreamMode.generate)


def corrupted() -> None:
    """Ponteiro startxref errado: o leitor precisa reconstruir a tabela (o qpdf repara)."""
    path = OUT / "xref-quebrada.pdf"
    save(simple("Xref quebrada"), "xref-quebrada.pdf", min_version="1.4",
         object_stream_mode=pikepdf.ObjectStreamMode.disable)
    data = path.read_bytes()
    marker = data.rindex(b"startxref\n") + len(b"startxref\n")
    end = data.index(b"\n", marker)
    path.write_bytes(data[:marker] + b"12" + data[end:])
    print("corrompido", path.name)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    canva_tags()
    degrades()
    active_content()
    protected()
    object_streams()
    corrupted()


if __name__ == "__main__":
    main()
