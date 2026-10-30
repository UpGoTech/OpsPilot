from setuptools import find_packages, setup

setup(
    name="opspilot_frappe",
    version="0.0.1",
    description="Per-user Hermes settings vault for OpsPilot",
    author="OpsPilot",
    author_email="opspilot@example.com",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=[],
)
